var fs = require("fs");

// cd - Central Directory
// cdr - Central Directory Record
// eocdr - End of Central Directory Record

open("test/cygwin-info-zip.zip", function(err, zipfile) {
  if (err) throw new Error(err);
  console.log(zipfile.comment);
  zipfile.readEntries(function(err, entries) {
    if (err) throw new Error(err);
    console.log(entries);
    zipfile.close();
  });
});

module.exports.open = open;
function open(path, callback) {
  if (callback == null) callback = defaultCallback;
  fs.open(path, "r", function(err, fd) {
    if (err) return callback(err);
    fopen(fd, callback);
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
        var entryCount = eocdrBuffer.readUInt16LE(10);
        // 12 - Size of central directory (bytes)
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
        // copy from the original buffer to make sure we're not pinning it from being GC'ed.
        eocdrBuffer.copy(comment, 0, 22, eocdrBuffer.length);
        return callback(null, new ZipFile(fd, cdOffset, entryCount, comment));
      }
      callback("end of central directory record signature not found");
    });
  });
}

function ZipFile(fd, cdOffset, entryCount, comment) {
  this.fd = fd;
  this.readEntryCursor = cdOffset;
  this.entryCount = entryCount;
  this.comment = comment;
}
ZipFile.prototype.close = function(callback) {
  if (callback == null) callback = defaultCallback;
  fs.close(this.fd, callback);
};
ZipFile.prototype.readEntries = function(callback) {
  var self = this;
  if (callback == null) callback = defaultCallback;
  var entries = [];
  keepReading();
  function keepReading() {
    self.readEntry(function(err, entry) {
      if (err) return callback(err);
      entries.push(entry);
      if (entries.length === self.entryCount) {
        callback(null, entries);
      } else {
        keepReading();
      }
    });
  }
};
ZipFile.prototype.readEntry = function(callback) {
  var self = this;
  if (callback == null) callback = defaultCallback;
  var buffer = new Buffer(46);
  readAll(this.fd, buffer, 0, buffer.length, this.readEntryCursor, function(err) {
    if (err) return callback(err);
    var entry = {};
    // 0 - Central directory file header signature
    var signature = buffer.readUInt32LE(0);
    if (signature !== 0x02014b50) return callback("invalid central directory file header signature: 0x" + signature.toString(16));
    // 4 - Version made by
    entry.versionMadeBy = buffer.readUInt16LE(4);
    // 6 - Version needed to extract (minimum)
    entry.versionNeededToExtract = buffer.readUInt16LE(6);
    // 8 - General purpose bit flag
    entry.generalPurposeBitFlag = buffer.readUInt16LE(8);
    // 10 - Compression method
    entry.compressionMethod = buffer.readUInt16LE(10);
    // 12 - File last modification time
    entry.lastModFileTime = buffer.readUInt16LE(12);
    // 14 - File last modification date
    entry.lastModFileDate = buffer.readUInt16LE(14);
    // 16 - CRC-32
    entry.crc32 = buffer.readUInt32LE(16);
    // 20 - Compressed size
    entry.compressedSize = buffer.readUInt32LE(20);
    // 24 - Uncompressed size
    entry.uncompressedSize = buffer.readUInt32LE(24);
    // 28 - File name length (n)
    entry.fileNameLength = buffer.readUInt16LE(28);
    // 30 - Extra field length (m)
    entry.extraFieldLength = buffer.readUInt16LE(30);
    // 32 - File comment length (k)
    entry.fileCommentLength = buffer.readUInt16LE(32);
    // 34 - Disk number where file starts
    // 36 - Internal file attributes
    entry.internalFileAttributes = buffer.readUInt16LE(36);
    // 38 - External file attributes
    entry.externalFileAttributes = buffer.readUInt32LE(38);
    // 42 - Relative offset of local file header
    entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42);

    self.readEntryCursor += 46;

    buffer = new Buffer(entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);
    readAll(self.fd, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
      if (err) return callback(err);
      // 46 - File name
      var encoding = entry.generalPurposeBitFlag & 0x800 ? "utf8" : "ascii";
      // TODO: replace ascii with CP437 using https://github.com/bnoordhuis/node-iconv
      entry.fileName = buffer.toString(encoding, 0, entry.fileNameLength);

      // 46+n - Extra field
      var fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
      var extraFieldBuffer = buffer.slice(entry.fileNameLength, fileCommentStart);
      entry.extraFields = [];
      var i = 0;
      while (i < extraFieldBuffer.length) {
        var headerId = extraFieldBuffer.readUInt16LE(i + 0);
        var dataSize = extraFieldBuffer.readUInt16LE(i + 2);
        var dataStart = i + 4;
        var dataEnd = dataStart + dataSize;
        var dataBuffer = new Buffer(dataSize);
        extraFieldBuffer.copy(dataBuffer, 0, dataStart, dataEnd);
        entry.extraFields.push({
          id: headerId,
          data: dataBuffer,
        });
        i = dataEnd;
      }

      // 46+n+m - File comment
      entry.fileComment = buffer.toString(encoding, fileCommentStart, fileCommentStart + entry.fileCommentLength);

      self.readEntryCursor += buffer.length;

      callback(null, entry);
    });
  });
};

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
