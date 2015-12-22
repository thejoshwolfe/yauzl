
var yauzl = require("../");
var path = require("path");
var fs = require("fs");
var Transform = require("stream").Transform;
var Pend = require("pend"); // npm install pend

var zipFilePath = process.argv[2];
if (zipFilePath == null || /^-/.test(zipFilePath)) {
  console.log(
    "usage: node unzip.js path/to/file.zip\n" +
    "\n" +
    "unzips the specified zip file into the current directory");
  process.exit(1);
}

function mkdirpSync(dir) {
  if (dir === ".") return;
  try {
    fs.statSync(dir);
    return; // already exists
  } catch (e) {
  }
  var parent = path.dirname(dir);
  mkdirpSync(parent);

  process.stdout.write(dir.replace(/\/$/, "") + "/\n");
  fs.mkdirSync(dir);
}

yauzl.open(zipFilePath, function(err, zipfile) {
  if (err) throw err;

  // Use Pend to do one thing at a time.
  // This enables prettier progress output.
  var pend = new Pend();
  pend.max = 1;

  // don't start any of the other `go()`s until we're done creating directories
  pend.go(function(callback) {
    zipfile.on("end", function() {
      callback();
    });
  });

  zipfile.on("entry", function(entry) {
    if (/\/$/.test(entry.fileName)) {
      // directory file names end with '/'
      mkdirpSync(entry.fileName);
    } else {
      // ensure parent directory exists
      mkdirpSync(path.dirname(entry.fileName));
      // call openReadStream before we return from this function,
      // or else the zipfile might autoclose before we get a chance to read it.
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        pend.go(function(callback) {
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
            callback();
          };

          // pump file contents
          readStream.pipe(filter).pipe(fs.createWriteStream(entry.fileName));
        });
      });
    }
  });
});

