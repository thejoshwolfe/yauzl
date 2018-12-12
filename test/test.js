var yauzl = require("../");
var zip64 = require("./zip64");
var rangeTest = require("./range-test");
var zipInZipTest = require("./zip-in-zip-test");
var fs = require("fs");
var path = require("path");
var Pend = require("pend");
var util = require("util");
var Readable = require("stream").Readable;
var Writable = require("stream").Writable;

// this is the date i made the example zip files and their content files,
// so this timestamp will be earlier than all the ones stored in these test zip files
// (and probably all future zip files).
// no timezone awareness, because that's how MS-DOS rolls.
var earliestTimestamp = new Date(2014, 7, 18, 0, 0, 0, 0);

var pend = new Pend();
// 1 thing at a time for better determinism/reproducibility
pend.max = 1;

var args = process.argv.slice(2);
function shouldDoTest(testPath) {
  if (args.length === 0) return true;
  return args.indexOf(testPath) !== -1;
}

// success tests
listZipFiles([path.join(__dirname, "success"), path.join(__dirname, "wrong-entry-sizes")]).forEach(function(zipfilePath) {
  if (!shouldDoTest(zipfilePath)) return;
  var optionConfigurations = [
    // you can find more options coverage in the failure tests.
    {lazyEntries: true},
    {lazyEntries: true, decodeStrings: false},
  ];
  if (/\/wrong-entry-sizes\//.test(zipfilePath)) {
    optionConfigurations.forEach(function(options) {
      options.validateEntrySizes = false;
    });
  }
  var openFunctions = [
    function(testId, options, callback) { yauzl.open(zipfilePath, options, callback); },
    function(testId, options, callback) { yauzl.fromBuffer(fs.readFileSync(zipfilePath), options, callback); },
    function(testId, options, callback) { openWithRandomAccess(zipfilePath, options, true, testId, callback); },
    function(testId, options, callback) { openWithRandomAccess(zipfilePath, options, false, testId, callback); },
  ];
  openFunctions.forEach(function(openFunction, i) {
    optionConfigurations.forEach(function(options, j) {
      var testId = zipfilePath + "(" + ["fd", "buffer", "randomAccess", "minimalRandomAccess"][i] + "," + j + "): ";
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
          switch (path.basename(name)) {
            case ".git_please_make_this_directory":
              // ignore
              break;
            case ".dont_expect_an_empty_dir_entry_for_this_dir":
              delete expectedArchiveContents[path.dirname(name)];
              break;
            default:
              // normal file
              expectedArchiveContents[key] = fs.readFileSync(realPath);
              break;
          }
        } else {
          if (name !== ".") expectedArchiveContents[key] = DIRECTORY;
          fs.readdirSync(realPath).forEach(function(child) {
            recursiveRead(path.join(name, child));
          });
        }
      }
      pend.go(function(zipfileCallback) {
        openFunction(testId, options, function(err, zipfile) {
          if (err) throw err;
          zipfile.readEntry();
          zipfile.on("entry", function(entry) {
            var fileName = entry.fileName;
            var fileComment = entry.fileComment;
            if (options.decodeStrings === false) {
              if (fileName.constructor !== Buffer) throw new Error(testId + "expected fileName to be a Buffer");
              fileName = manuallyDecodeFileName(fileName);
              fileComment = manuallyDecodeFileName(fileComment);
            }
            if (fileComment !== "") throw new Error(testId + "expected empty fileComment");
            var messagePrefix = testId + fileName + ": ";
            var timestamp = entry.getLastModDate();
            if (timestamp < earliestTimestamp) throw new Error(messagePrefix + "timestamp too early: " + timestamp);
            if (timestamp > new Date()) throw new Error(messagePrefix + "timestamp in the future: " + timestamp);
            var fileNameKey = fileName.replace(/\/$/, "");
            var expectedContents = expectedArchiveContents[fileNameKey];
            if (expectedContents == null) {
              throw new Error(messagePrefix + "not supposed to exist");
            }
            delete expectedArchiveContents[fileNameKey];
            if (fileName !== fileNameKey) {
              // directory
              console.log(messagePrefix + "pass");
              zipfile.readEntry();
            } else {
              var isEncrypted = entry.isEncrypted();
              var isCompressed = entry.isCompressed();
              if (/traditional-encryption/.test(zipfilePath) !== isEncrypted) {
                throw new Error("expected traditional encryption in the traditional encryption test cases");
                if (/traditional-encryption-and-compression/.test(zipfilePath) !== isCompressed) {
                  throw new Error("expected traditional encryption and compression in the traditional encryption and compression test case");
                }
              }
              if (isEncrypted) {
                zipfile.openReadStream(entry, {
                  decrypt: false,
                  decompress: isCompressed ? false : null,
                }, onReadStream);
              } else {
                zipfile.openReadStream(entry, onReadStream);
              }
              function onReadStream(err, readStream) {
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
                  zipfile.readEntry();
                });
                readStream.on("error", function(err) {
                  throw err;
                });
              }
            }
          });
          zipfile.on("end", function() {
            for (var fileName in expectedArchiveContents) {
              throw new Error(testId + fileName + ": missing file");
            }
            console.log(testId + "pass");
            zipfileCallback();
          });
          zipfile.on("close", function() {
            console.log(testId + "closed");
          });
        });
      });
    });
  });
});

// failure tests
listZipFiles([path.join(__dirname, "failure")]).forEach(function(zipfilePath) {
  if (!shouldDoTest(zipfilePath)) return;
  var expectedErrorMessage = path.basename(zipfilePath).replace(/(_\d+)?\.zip$/, "");
  var failedYet = false;
  var emittedError = false;
  pend.go(function(cb) {
    var operationsInProgress = 0;
    if (/invalid characters in fileName/.test(zipfilePath)) {
      // this error can only happen when you specify an option
      yauzl.open(zipfilePath, {strictFileNames: true}, onZipFile);
    } else {
      yauzl.open(zipfilePath, onZipFile);
    }
    return;

    function onZipFile(err, zipfile) {
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
    }
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

// fromRandomAccessReader with errors
pend.go(function(cb) {
  util.inherits(TestRandomAccessReader, yauzl.RandomAccessReader);
  function TestRandomAccessReader() {
    yauzl.RandomAccessReader.call(this);
  }
  TestRandomAccessReader.prototype._readStreamForRange = function(start, end) {
    var brokenator = new Readable();
    brokenator._read = function(size) {
      brokenator.emit("error", new Error("all reads fail"));
    };
    return brokenator;
  };

  var reader = new TestRandomAccessReader();
  yauzl.fromRandomAccessReader(reader, 0x1000, function(err, zipfile) {
    if (err.message === "all reads fail") {
      console.log("fromRandomAccessReader with errors: pass");
      cb();
    } else {
      throw err;
    }
  });
});

// read some entries, then close.
pend.go(function(cb) {
  var prefix = "read some entries then close: ";
  // this zip file should have at least 3 entries in it
  yauzl.open(path.join(__dirname, "success/unicode.zip"), {lazyEntries: true}, function(err, zipfile) {
    if (err) throw err;

    var entryCount = 0;

    zipfile.readEntry();
    zipfile.on("entry", function(entry) {
      entryCount += 1;
      console.log(prefix + "entryCount: " + entryCount);
      if (entryCount < 3) {
        zipfile.readEntry();
      } else if (entryCount === 3) {
        zipfile.close();
        console.log(prefix + "close()");
      } else {
        throw new Error(prefix + "read too many entries");
      }
    });
    zipfile.on("close", function() {
      console.log(prefix + "closed");
      if (entryCount === 3) {
        console.log(prefix + "pass");
        cb();
      } else {
        throw new Error(prefix + "not enough entries read before closed");
      }
    });
    zipfile.on("end", function() {
      throw new Error(prefix + "we weren't supposed to get to the end");
    });
    zipfile.on("error", function(err) {
      throw err;
    });
  });
});

// abort open read stream
pend.go(function(cb) {
  var prefix = "abort open read stream: ";
  yauzl.open(path.join(__dirname, "big-compression.zip"), {lazyEntries: true}, function(err, zipfile) {
    if (err) throw err;

    var doneWithStream = false;

    zipfile.readEntry();
    zipfile.on("entry", function(entry) {
      zipfile.openReadStream(entry, function(err, readStream) {
        var writer = new Writable();
        var bytesSeen = 0;
        writer._write = function(chunk, encoding, callback) {
          bytesSeen += chunk.length;
          if (bytesSeen < entry.uncompressedSize / 10) {
            // keep piping a bit longer
            callback();
          } else {
            // alright, i've seen enough.
            doneWithStream = true;
            console.log(prefix + "destroy()");
            readStream.unpipe(writer);
            readStream.destroy();

            // now keep trying to use the fd
            zipfile.readEntry();
          }
        };
        readStream.pipe(writer);
      });
    });
    zipfile.on("end", function() {
      console.log(prefix + "end");
    });
    zipfile.on("close", function() {
      console.log(prefix + "closed");
      if (doneWithStream) {
        console.log(prefix + "pass");
        cb();
      } else {
        throw new Error(prefix + "closed prematurely");
      }
    });
    zipfile.on("error", function(err) {
      throw err;
    });
  });
});

// zip64
pend.go(zip64.runTest);

// openReadStream with range
pend.go(rangeTest.runTest);

// openReadStream with range for files in a zip that is in another zip
pend.go(zipInZipTest.runTest);

pend.wait(function() {
  // if you don't see this, something never happened.
  console.log("done");
});


function listZipFiles(dirList) {
  var zipfilePaths = [];
  dirList.forEach(function(dir) {
    fs.readdirSync(dir).filter(function(filepath) {
      return /\.zip$/.exec(filepath);
    }).forEach(function(name) {
      zipfilePaths.push(path.relative(".", path.join(dir, name)));
    });
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
  name = name.replace(/qi ge fangjian/g, "七个房间");
  return name;
}

function manuallyDecodeFileName(fileName) {
  // file names in this test suite are always utf8 compatible.
  fileName = fileName.toString("utf8");
  fileName = fileName.replace("\\", "/");
  if (fileName === "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f") {
    // we're not doing the unicode path extra field decoding outside of yauzl.
    // just hardcode this answer.
    fileName = "七个房间.txt";
  }
  return fileName;
}

function openWithRandomAccess(zipfilePath, options, implementRead, testId, callback) {
  util.inherits(InefficientRandomAccessReader, yauzl.RandomAccessReader);
  function InefficientRandomAccessReader() {
    yauzl.RandomAccessReader.call(this);
  }
  InefficientRandomAccessReader.prototype._readStreamForRange = function(start, end) {
    return fs.createReadStream(zipfilePath, {start: start, end: end - 1});
  };
  if (implementRead) {
    InefficientRandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
      fs.open(zipfilePath, "r", function(err, fd) {
        if (err) throw err;
        fs.read(fd, buffer, offset, length, position, function(err, bytesRead) {
          if (bytesRead < length) throw new Error("unexpected EOF");
          fs.close(fd, function(err) {
            if (err) throw err;
            callback();
          });
        });
      });
    };
  }
  InefficientRandomAccessReader.prototype.close = function(cb) {
    console.log(testId + "close hook");
    yauzl.RandomAccessReader.prototype.close.call(this, cb);
  };

  fs.stat(zipfilePath, function(err, stats) {
    if (err) throw err;
    var reader = new InefficientRandomAccessReader();
    yauzl.fromRandomAccessReader(reader, stats.size, options, function(err, zipfile) {
      if (err) throw err;
      callback(null, zipfile);
    });
  });
}
