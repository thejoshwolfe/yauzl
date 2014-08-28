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
  var expectedPathPrefix = zipfilePath.replace(/\.zip$/, "");
  // TODO: directories, yo.
  var expectedArchiveContents = {};
  var DIRECTORY = 1; // not a string
  recursiveRead(".");
  function recursiveRead(name) {
    var realPath = path.join(expectedPathPrefix, name);
    if (fs.statSync(realPath).isFile()) {
      if (path.basename(name) !== ".git_please_make_this_directory") {
        expectedArchiveContents[name] = fs.readFileSync(realPath);
      }
    } else {
      if (name !== ".") expectedArchiveContents[name] = DIRECTORY;
      fs.readdirSync(realPath).forEach(function(child) {
        recursiveRead(path.join(name, child));
      });
    }
  }
  pend.go(function(zipfileCallback) {
    yauzl.open(zipfilePath, function(err, zipfile) {
      if (err) throw err;
      var entryProcessing = new Pend();
      entryProcessing.max = 1;
      zipfile.on("entry", function(entry) {
        var messagePrefix = zipfilePath + ": " + entry.fileName + ": ";
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
            throw new Error(zipfilePath + ": " + fileName + ": missing file");
          }
          console.log(zipfilePath + ": pass");
          zipfileCallback();
        });
      });
      zipfile.on("close", function() {
        console.log(zipfilePath + ": closed");
      });
    });
  });
});

// failure tests
listZipFiles(path.join(__dirname, "failure")).forEach(function(zipfilePath) {
  var expectedErrorMessage = path.basename(zipfilePath).replace(/\.zip$/, "");
  var failedYet = false;
  pend.go(function(cb) {
    yauzl.open(zipfilePath, function(err, zipfile) {
      if (err) return checkErrorMessage(err, cb);
      zipfile.on("error", function(err) {
        checkErrorMessage(err);
      });
      zipfile.on("entry", function(entry) {
        pend.go(function(cb) {
          // let's also try to read directories, cuz whatever.
          zipfile.openReadStream(entry, function(err, stream) {
            if (err) return checkErrorMessage(err, cb);
            stream.on("data", function() {
              // don't care
            });
            stream.on("error", function(err) {
              checkErrorMessage(err, cb);
            });
            stream.on("end", function() {
              cb();
            });
          });
        });
      });
      zipfile.on("end", function() {
        // last thing should be a check for the failure
        pend.go(function(cb) {
          if (!failedYet) {
            throw new Error(zipfilePath + ": expected failure");
          }
          cb();
        });
        cb();
      });
    });
    function checkErrorMessage(err, cb) {
      var actualMessage = err.message;
      if (actualMessage.replace(/[^0-9A-Za-z ]/g, "") !== expectedErrorMessage) {
        throw new Error(zipfilePath + ": wrong error message: " + actualMessage);
      }
      console.log(zipfilePath + ": pass");
      failedYet = true;
      cb();
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
