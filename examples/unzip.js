
var yauzl = require("../");
var path = require("path");
var fs = require("fs");
var Transform = require("stream").Transform;

var zipFilePath = process.argv[2];
if (zipFilePath == null || /^-/.test(zipFilePath)) {
  console.log(
    "usage: node unzip.js path/to/file.zip\n" +
    "\n" +
    "unzips the specified zip file into the current directory");
  process.exit(1);
}

function mkdirp(dir, cb) {
  if (dir === ".") return cb();
  fs.stat(dir, function(err) {
    if (err == null) return cb(); // already exists

    var parent = path.dirname(dir);
    mkdirp(parent, function() {
      process.stdout.write(dir.replace(/\/$/, "") + "/\n");
      fs.mkdir(dir, cb);
    });
  });
}

yauzl.open(zipFilePath, {lazyEntries: true}, function(err, zipfile) {
  if (err) throw err;

  zipfile.readEntry();
  zipfile.on("close", function() {
    console.log("done");
  });
  zipfile.on("entry", function(entry) {
    if (/\/$/.test(entry.fileName)) {
      // directory file names end with '/'
      mkdirp(entry.fileName, function() {
        if (err) throw err;
        zipfile.readEntry();
      });
    } else {
      // ensure parent directory exists
      mkdirp(path.dirname(entry.fileName), function() {
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) throw err;
          // report progress through large files
          var byteCount = 0;
          var totalBytes = entry.uncompressedSize;
          var lastReportedString = byteCount + "/" + totalBytes + "  0%";
          process.stdout.write(entry.fileName + "..." + lastReportedString);
          function reportString(msg) {
            var clearString = "";
            for (var i = 0; i < lastReportedString.length; i++) {
              clearString += "\b";
              if (i >= msg.length) {
                clearString += " \b";
              }
            }
            process.stdout.write(clearString + msg);
            lastReportedString = msg;
          }
          // report progress at 60Hz
          var progressInterval = setInterval(function() {
            reportString(byteCount + "/" + totalBytes + "  " + ((byteCount / totalBytes * 100) | 0) + "%");
          }, 1000 / 60);
          var filter = new Transform();
          filter._transform = function(chunk, encoding, cb) {
            byteCount += chunk.length;
            cb(null, chunk);
          };
          filter._flush = function(cb) {
            clearInterval(progressInterval);
            reportString("");
            // delete the "..."
            process.stdout.write("\b \b\b \b\b \b\n");
            cb();
            zipfile.readEntry();
          };

          // pump file contents
          readStream.pipe(filter).pipe(fs.createWriteStream(entry.fileName));
        });
      });
    }
  });
});

