
var yauzl = require("../");
var path = require("path");
var fs = require("fs");
var util = require("util");
var Transform = require("stream").Transform;

var zipFilePath;
var offsetArg;
var lenArg;
var endArg;
var args = process.argv.slice(2);
for (var i = 0; i < args.length; i++) {
  var arg = args[i];
  if (arg === "--offset") {
    i += 1;
    offsetArg = parseInt(args[i]);
    if (isNaN(offsetArg)) throw new Error("--offset argument not parsable as an int");
  } else if (arg === "--len") {
    i += 1;
    lenArg = parseInt(args[i]);
    if (isNaN(lenArg)) throw new Error("--len argument not parsable as an int");
  } else if (arg === "--end") {
    i += 1;
    endArg = parseInt(args[i]);
    if (isNaN(endArg)) throw new Error("--end argument not parsable as an int");
  } else if (["-h", "--help"].indexOf(arg) !== -1) {
    // print help
    zipFilePath = null;
    break;
  } else if (/^--/.test(arg)) {
    throw new Error("unrecognized option: " + arg);
  } else {
    if (zipFilePath != null) throw new Error("too many arguments");
    zipFilePath = arg;
  }
}
if (zipFilePath == null || /^-/.test(zipFilePath) || (lenArg != null && endArg != null)) {
  console.log(
    "usage: node unzip.js [options] path/to/file.zip\n" +
    "\n" +
    "unzips the specified zip file into the current directory\n" +
    "\n" +
    "options:\n" +
    "  --offset START\n" +
    "  --len LEN\n" +
    "  --end END\n" +
    "    interprets the middle of the specified file as a zipfile.\n" +
    "    starting START number of bytes in from the beginning (default 0).\n" +
    "    end with length of LEN (default is all the way to the end of the file).\n" +
    "    or end at byte offset END (exclusive) (default is the end of the file).\n" +
    "    end can be negative to count backwards from the end of the file\n" +
    "    (example, `--end -1` excludes the last byte of the file).\n" +
    "");
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

if (offsetArg != null || lenArg != null || endArg != null) {
  openMiddleOfFile(zipFilePath, {lazyEntries: true}, offsetArg, lenArg, endArg, handleZipFile);
} else {
  yauzl.open(zipFilePath, {lazyEntries: true}, handleZipFile);
}

function openMiddleOfFile(zipFilePath, options, offsetArg, lenArg, endArg, handleZipFile) {
  fs.open(zipFilePath, "r", function(err, fd) {
    if (err != null) throw err;
    fs.fstat(fd, function(err, stats) {
      // resolve optional parameters
      if (offsetArg == null) offsetArg = 0;
      if (lenArg == null && endArg == null) endArg = stats.size;
      if (endArg == null) endArg = lenArg + offsetArg;
      else if (endArg < 0) endArg = stats.size + endArg;
      // validate parameters
      if (offsetArg < 0) throw new Error("--offset < 0");
      if (lenArg < 0) throw new Error("--len < 0");
      if (offsetArg > endArg) throw new Error("--offset > --end");
      if (endArg > stats.size) throw new Error("--end/--len goes past EOF");

      function adjustOffset(n) {
        return n + offsetArg;
      }

      // extend RandomAccessReader
      function MiddleOfFileReader() {
        yauzl.RandomAccessReader.call(this);
      }
      util.inherits(MiddleOfFileReader, yauzl.RandomAccessReader);
      // implement required and option methods
      MiddleOfFileReader.prototype._readStreamForRange = function(start, end) {
        return fs.createReadStream(null, {
          fd: fd,
          // shift the start and end offsets
          start: start + offsetArg,
          end: end + offsetArg - 1, // the -1 is because fs.createReadStream()'s end option is inclusive
          autoClose: false,
        });
      };
      MiddleOfFileReader.prototype.read = function(buffer, offset, length, position, callback) {
        // shift the position
        fs.read(fd, buffer, offset, length, position + offsetArg, callback);
      };
      MiddleOfFileReader.prototype.close = function(callback) {
        fs.close(fd, callback);
      };

      yauzl.fromRandomAccessReader(new MiddleOfFileReader(), endArg - offsetArg, options, handleZipFile);
    });
  });
}

function handleZipFile(err, zipfile) {
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
}

