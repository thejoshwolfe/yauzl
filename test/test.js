var yauzl = require("../");
var fs = require("fs");
var path = require("path");
var Pend = require("pend");

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
  fs.readdirSync(expectedPathPrefix).forEach(function(name) {
    expectedArchiveContents[name] = fs.readFileSync(path.join(expectedPathPrefix, name));
  });
  pend.go(function(zipfileCallback) {
    yauzl.open(zipfilePath, function(err, zipfile) {
      if (err) throw err;
      zipfile.readEntries(function(err, entries) {
        if (err) throw err;
        var zipfilePend = new Pend();
        zipfilePend.max = 1;
        entries.forEach(function(entry) {
          var messagePrefix = zipfilePath + ": " + entry.fileName + ": ";
          zipfilePend.go(function(entryCallback) {
            var expectedContents = expectedArchiveContents[entry.fileName];
            if (expectedContents == null) {
              throw new Error(messagePrefix + "not supposed to exist");
            }
            delete expectedArchiveContents[entry.fileName];
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
          });
        });
        zipfilePend.wait(function() {
          for (var fileName in expectedArchiveContents) {
            throw new Error(zipfilePath + ": " + fileName + ": missing file");
          }
          zipfileCallback();
        });
      });
    });
  });
});
