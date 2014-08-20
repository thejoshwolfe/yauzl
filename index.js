var fs = require("fs");

// cd - Central Directory
// cdr - Central Directory Record
// eocdr - End of Central Directory Record

open("test/cygwin-info-zip.zip", function(err, zipfile) {
  if (err) throw new Error(err);
  console.log(zipfile.comment);
  zipfile.close();
});

module.exports.open = open;
function open(path, callback) {
  if (callback == null) callback = defaultCallback;
  fs.open(path, "r", function(err, fd) {
    if (err) return callback(err);
    fopen(cd, callback);
  });
}

module.exports.fopen = fopen;
function fopen(fd, callback) {
  if (callback == null) callback = defaultCallback;
  fs.fstat(fd, function(err, stats) {
    if (err) return callback(err);
    verbose("searching backwards for the eocdr signature");
    // the last field of the eocdr is a variable-length comment.
    // the comment size is encoded in a 2-byte field in the eocdr, which we can't find without trudging backwards through the comment to find it.
    // as a consequence of this design decision, it's possible to have ambiguous zip file metadata if, for example, a coherent eocdr was in the comment.
    // we search backwards for the first eocdr signature, and hope that whoever made the zip file was smart enough to forbid the eocdr signature in the comment.
    var eocdrWithoutCommentSize = 22;
    var maxCommentSize = 0x10000; // 2-byte size
    var bufferSize = Math.min(eocdrWithoutCommentSize + maxCommentSize, stats.size);
    var buffer = new Buffer(bufferSize);
    var bufferReadStart = stats.size - buffer.length;
    readAll(fd, buffer, 0, bufferSize, bufferReadStart, function(err) {
      for (var i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
        if (buffer.readUInt32LE(i) !== 0x06054b50) continue;
        verbose("found eocdr at offset: " + (bufferReadStart + i));
        var eocdrBuffer = buffer.slice(i);

        // 0 - End of central directory signature = 0x06054b50
        // 4 - Number of this disk
        var diskNumber = eocdrBuffer.readUInt16LE(4);
        if (diskNumber !== 0) return callback("multi-disk zip files are not supported: found disk number: " + diskNumber);
        // 6 - Disk where central directory starts
        // 8 - Number of central directory records on this disk
        // 10 - Total number of central directory records
        var cdrCount = eocdrBuffer.readUInt16LE(10);
        // 12 - Size of central directory (bytes)
        var cdSize = eocdrBuffer.readUInt32LE(12);
        // 16 - Offset of start of central directory, relative to start of archive
        var cdOffset = eocdrBuffer.readUInt32LE(16);
        // 20 - Comment length
        var commentLength = eocdrBuffer.readUInt16LE(20);
        var expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;
        if (commentLength !== expectedCommentLength) {
          return callback("invalid comment length. expected: " + expectedCommentLength + ". found: " + commentLength);
        }
        // 22 - Comment
        var comment = new Buffer(commentLength);
        // the comment length is typcially 0.
        // copy the original buffer to make sure we're not pinning it from being GC'ed.
        eocdrBuffer.copy(comment, 0, 22, eocdrBuffer.length);
        return callback(null, newZipFile(fd, cdOffset, cdSize, cdrCount, comment));
      }
      callback("end of central directory record signature not found");
    });
  });
}

function newZipFile(fd, cdOffset, cdSize, cdrCount, comment) {
  function ZipFile() {
    this.comment = comment;
  }
  ZipFile.prototype.close = function(callback) {
    if (callback == null) callback = defaultCallback;
    fs.close(fd, callback);
  };
  return new ZipFile();
}

function verbose(message) {
  console.log(message);
}

function readAll(fd, buffer, offset, length, position, callback) {
  keepReading();
  function keepReading() {
    fs.read(fd, buffer, offset, length, position, function(err, bytesRead) {
      if (err) return callback(err);
      if (bytesRead >= length) return callback(null, buffer);
      offset += bytesRead;
      length -= bytesRead;
      position += bytesRead;
      keepReading();
    });
  }
}
function defaultCallback(err) {
  if (err) throw new Error(err);
}
