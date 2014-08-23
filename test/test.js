var yauzl = require("../");
var fs = require("fs");
var path = require("path");
var Pend = require("pend");

var zipfilePaths = fs.readdirSync(__dirname).filter(function(filepath) {
  return /\.zip$/.exec(filepath);
}).map(function(name) {
  return path.join(__dirname, name);
});

var pend = new Pend();
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
      var zipfilePend = new Pend();
      zipfilePend.max = 1;
      zipfile.readEntries(function(err, entries) {
        if (err) throw err;
        entries.forEach(function(entry) {
          zipfilePend.go(function(entryCallback) {
            var expectedContents = expectedArchiveContents[entry.fileName];
            if (expectedContents == null) {
              throw new Error(zipfilePath + ": " + entry.fileName + ": is not supposed to exist");
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
                  throw new Error(zipfilePath + ": " + entry.fileName + ": has wrong contents");
                }
                entryCallback();
              });
              readStream.on("error", function(err) {
                throw err;
              });
            });
          });
        });
      });
      zipfilePend.wait(zipfileCallback);
    });
  });
});
