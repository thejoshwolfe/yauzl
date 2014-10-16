var yauzl = require("../");
var fs = require("fs");
var path = require("path");
var Pend = require("pend");

// this is the date i made the example zip files and their content files,
// so this timestamp will be earlier than all the ones stored in these test zip files
// (and probably all future zip files).
// no timezone awareness, because that's how MS-DOS rolls.
var earliestTimestamp = new Date(2014, 7, 18, 0, 0, 0, 0);

var pend = new Pend();
// 1 thing at a time for better determinism/reproducibility
pend.max = 1;

// success tests
listZipFiles(path.join(__dirname, "success")).forEach(function(zipfilePath) {
  var openFunctions = [
    function(callback) { yauzl.open(zipfilePath, callback); },
    function(callback) { yauzl.fromBuffer(fs.readFileSync(zipfilePath), callback); },
  ];
  openFunctions.forEach(function(openFunction, i) {
    var testId = zipfilePath + "(" + ["fd", "buffer"][i] + "): ";
    var expectedPathPrefix = zipfilePath.replace(/\.zip$/, "");
    var expectedArchiveContents = {};
    var DIRECTORY = 1; // not a string
    recursiveRead(".");
    function recursiveRead(name) {
      // windows support? whatever.
      var name = name.replace(/\\/g, "/");
      var key = addUnicodeSupport(name);
      var realPath = path.join(expectedPathPrefix, name);
      if (fs.statSync(realPath).isFile()) {
        if (path.basename(name) !== ".git_please_make_this_directory") {
          expectedArchiveContents[key] = fs.readFileSync(realPath);
        }
      } else {
        if (name !== ".") expectedArchiveContents[key] = DIRECTORY;
        fs.readdirSync(realPath).forEach(function(child) {
          recursiveRead(path.join(name, child));
        });
      }
    }
    pend.go(function(zipfileCallback) {
      openFunction(function(err, zipfile) {
        if (err) throw err;
        var entryProcessing = new Pend();
        entryProcessing.max = 1;
        zipfile.on("entry", function(entry) {
          var messagePrefix = testId + entry.fileName + ": ";
          var timestamp = entry.getLastModDate();
          if (timestamp < earliestTimestamp) throw new Error(messagePrefix + "timestamp too early: " + timestamp);
          if (timestamp > new Date()) throw new Error(messagePrefix + "timestamp in the future: " + timestamp);
          entryProcessing.go(function(entryCallback) {
            var fileNameKey = entry.fileName.replace(/\/$/, "");
            var expectedContents = expectedArchiveContents[fileNameKey];
            if (expectedContents == null) {
              throw new Error(messagePrefix + "not supposed to exist");
            }
            delete expectedArchiveContents[fileNameKey];
            if (entry.fileName !== fileNameKey) {
              // directory
              console.log(messagePrefix + "pass");
              entryCallback();
            } else {
              zipfile.openReadStream(entry, function(err, readStream) {
                if (err) throw err;
                var buffers = [];
                readStream.on("data", function(data) {
                  buffers.push(data);
                });
                readStream.on("end", function() {
                  var actualContents = Buffer.concat(buffers);
                  // uh. there's no buffer equality check?
                  var equal = actualContents.toString("binary") === expectedContents.toString("binary");
                  if (!equal) {
                    throw new Error(messagePrefix + "wrong contents");
                  }
                  console.log(messagePrefix + "pass");
                  entryCallback();
                });
                readStream.on("error", function(err) {
                  throw err;
                });
              });
            }
          });
        });
        zipfile.on("end", function() {
          entryProcessing.wait(function() {
            for (var fileName in expectedArchiveContents) {
              throw new Error(testId + fileName + ": missing file");
            }
            console.log(testId + "pass");
            zipfileCallback();
          });
        });
        zipfile.on("close", function() {
          console.log(testId + "closed");
        });
      });
    });
  });
});

// failure tests
listZipFiles(path.join(__dirname, "failure")).forEach(function(zipfilePath) {
  var expectedErrorMessage = path.basename(zipfilePath).replace(/\.zip$/, "");
  var failedYet = false;
  var emittedError = false;
  pend.go(function(cb) {
    var operationsInProgress = 0;
    yauzl.open(zipfilePath, function(err, zipfile) {
      if (err) return checkErrorMessage(err);
      zipfile.on("error", function(err) {
        noEventsAllowedAfterError();
        emittedError = true;
        checkErrorMessage(err);
      });
      zipfile.on("entry", function(entry) {
        noEventsAllowedAfterError();
        // let's also try to read directories, cuz whatever.
        operationsInProgress += 1;
        zipfile.openReadStream(entry, function(err, stream) {
          if (err) return checkErrorMessage(err);
          stream.on("error", function(err) {
            checkErrorMessage(err);
          });
          stream.on("data", function(data) {
            // ignore
          });
          stream.on("end", function() {
            doneWithSomething();
          });
        });
      });
      operationsInProgress += 1;
      zipfile.on("end", function() {
        noEventsAllowedAfterError();
        doneWithSomething();
      });
      function doneWithSomething() {
        operationsInProgress -= 1;
        if (operationsInProgress !== 0) return;
        if (!failedYet) {
          throw new Error(zipfilePath + ": expected failure");
        }
      }
    });
    function checkErrorMessage(err) {
      var actualMessage = err.message.replace(/[^0-9A-Za-z-]+/g, " ");
      if (actualMessage !== expectedErrorMessage) {
        throw new Error(zipfilePath + ": wrong error message: " + actualMessage);
      }
      console.log(zipfilePath + ": pass");
      failedYet = true;
      operationsInProgress = -Infinity;
      cb();
    }
    function noEventsAllowedAfterError() {
      if (emittedError) throw new Error("events emitted after error event");
    }
  });
});

pend.wait(function() {
  // if you don't see this, something never happened.
  console.log("done");
});

function listZipFiles(dir) {
  var zipfilePaths = fs.readdirSync(dir).filter(function(filepath) {
    return /\.zip$/.exec(filepath);
  }).map(function(name) {
    return path.relative(".", path.join(dir, name));
  });
  zipfilePaths.sort();
  return zipfilePaths;
}

function addUnicodeSupport(name) {
  // reading and writing unicode filenames on mac is broken.
  // we keep all our test data ascii, and then swap in the real names here.
  // see https://github.com/thejoshwolfe/yauzl/issues/10
  name = name.replace(/Turmion Katilot/g, "Turmion Kätilöt");
  name = name.replace(/Mista veri pakenee/g, "Mistä veri pakenee");
  return name;
}
