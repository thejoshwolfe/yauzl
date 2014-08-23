var yauzl = require("../");
var fs = require("fs");
var path = require("path");
var Pend = require("pend");

// git doesn't store empty directories, but we need one for the empty zip file test
(function() {
  var emptyDirectoryPath = path.join(__dirname, "empty");
  if (!fs.existsSync(emptyDirectoryPath)) {
    fs.mkdirSync(emptyDirectoryPath);
  }
})();

var zipfilePaths = fs.readdirSync(__dirname).filter(function(filepath) {
  return /\.zip$/.exec(filepath);
}).map(function(name) {
  return path.relative(".", path.join(__dirname, name));
});
zipfilePaths.sort();

var pend = new Pend();
// 1 thing at a time for reproducibility
pend.max = 1;
zipfilePaths.forEach(function(zipfilePath) {
  var expectedPathPrefix = zipfilePath.replace(/\.zip$/, "");
  // TODO: directories, yo.
  var expectedArchiveContents = {};
  var DIRECTORY = 1; // not a string
  recursiveRead(".");
  function recursiveRead(name) {
    var realPath = path.join(expectedPathPrefix, name);
    if (fs.statSync(realPath).isFile()) {
      expectedArchiveContents[name] = fs.readFileSync(realPath);
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
    });
  });
});
pend.wait(function() {
  // if you don't see this, something never happened.
  console.log("done");
});
