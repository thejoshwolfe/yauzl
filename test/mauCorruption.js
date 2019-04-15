var yauzl = require("../");
var zlib = require("zlib");
var Writable = require("stream").Writable;
var Readable = require("stream").Readable;
var BufferList = require("bl");
var util = require("util");

// Node 10 deprecated new Buffer().
var newBuffer;
if (typeof Buffer.alloc === "function") {
  newBuffer = function(len, fillValue) {
    return Buffer.alloc(len, fillValue);
  };
} else {
  newBuffer = function(len, fillValue) {
    var b = new Buffer(len);
    b.fill(fillValue);
    return b;
  };
}
var bufferFromArray;
if (typeof Buffer.from === "function") {
  bufferFromArray = function(array) {
    return Buffer.from(array);
  };
} else {
  bufferFromArray = function(array) {
    return new Buffer(array);
  };
}

function cli() {
  testCrowdedFile(function() {
    testBigFile(function() {
      console.log("done");
    });
  });
}

function mauCorrupted16(number, label) {
  var corruptedNumber = number & 0xffff;
  if (corruptedNumber !== number) {
    console.log("corrupting 0x" + number.toString(16) + " to 0x" + corruptedNumber.toString(16) + " // " + label);
  }
  var buffer = newBuffer(2, 0);
  buffer.writeUInt16LE(corruptedNumber, 0);
  return buffer;
}
function mauCorrupted32(number, label) {
  var corruptedNumber = (number & 0xffffffff) >>> 0;
  if (corruptedNumber !== number) {
    console.log("corrupting 0x" + number.toString(16) + " to 0x" + corruptedNumber.toString(16) + " // " + label);
  }
  var buffer = newBuffer(4, 0);
  buffer.writeUInt32LE(corruptedNumber, 0);
  return buffer;
}

function testCrowdedFile(done) {
  var localEntrySize = 123; // TODO
  var centralDirectoryRecordSize = 123; // TODO

  var numberOfEntries = 0;
  var centralDirectoryOffset = numberOfEntries * localEntrySize;
  var centralDirectorySize = numberOfEntries * centralDirectoryRecordSize;

  var mauNE = mauCorrupted16(numberOfEntries, "number of entries");
  var mauEO = mauCorrupted32(centralDirectoryOffset, "offset of start of central directory with respect to the starting disk number");
  var mauSC = mauCorrupted32(centralDirectorySize, "size of central directory");

  var segments = [
    {label: "local file stuff", length: centralDirectoryOffset, slice: function(start, end) {
      // TODO
      return newBuffer(0, 0);
    }},

    {label: "central directory", length: centralDirectorySize, slice: function(start, end) {
      // TODO
      return newBuffer(0, 0);
    }},

    {label: "eocdr", buffer: bufferFromArray([
      // End of central directory record
      0x50, 0x4b, 0x05, 0x06, // End of central directory signature
      0x00, 0x00,             // Number of this disk
      0x00, 0x00,             // Disk where central directory starts
      mauNE[0], mauNE[1],     // Number of central directory records on this disk
      mauNE[0], mauNE[1],     // Total number of central directory records
      mauSC[0], mauSC[1], mauSC[2], mauSC[3], // Size of central directory (bytes)
      mauEO[0], mauEO[1], mauEO[2], mauEO[3], // Offset of start of central directory, relative to start of archive
      0x00, 0x00,             // Comment Length
    ])},
  ];
  var reader = new ReadBasedRandomAccessReader();
  reader.read = makeSegmentedReadFunction(segments);

  yauzl.fromRandomAccessReader(reader, segments[segments.length - 1].end, {lazyEntries: true}, function(err, zipfile) {
    if (err) throw err;
    if (zipfile.entryCount !== numberOfEntries) throw new Error("wrong number of entries");
    setImmediate(function() {zipfile.readEntry();});
    var verifiedCount = 0;
    zipfile.on("entry", function(entry) {
      if (err) throw err;
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        // should be empty
        readStream.pipe(BufferList(function(err, contents) {
          if (err) throw err;
          if (contents.length !== 0) throw new Error("expected empty contents");
          verifiedCount++;
          zipfile.readEntry();
        }));
      });
    });
    zipfile.on("end", function() {
      if (verifiedCount !== zipfile.entryCount) throw new Error("didn't verify enough");
      console.log("entry data verified count: " + verifiedCount);
      done();
    });
  });
}

function testBigFile(done) {
  // this is the minimum size to corrupt the uncompressed size
  var gzipBlocks = 2; // 0x10002; // TODO: make this pass while i'm writing the other test

  var theBigCompressedSize = (0xffff + 5) * gzipBlocks;
  var theBigUncompressedSize = 0xffff * gzipBlocks;
  var localFileHeader2Offset = 0x68 + theBigCompressedSize;
  var eocdrOffset = 0x9d + theBigCompressedSize;

  // buffer representations of the above in the mau-corrupted format
  var mauCS = mauCorrupted32(theBigCompressedSize, "compressed size");
  var mauUS = mauCorrupted32(theBigUncompressedSize, "uncompressed size");
  var mau2O = mauCorrupted32(localFileHeader2Offset, "relative offset of local header");
  var mauEO = mauCorrupted32(eocdrOffset, "offset of start of central directory with respect to the starting disk number");

  var segments = [
    {label: "unimportant stuff", buffer: bufferFromArray([
      // Local File Header (#0)
      0x50, 0x4b, 0x03, 0x04, // Local file header signature
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x5a, 0x7c,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x00, 0x00, 0x00, 0x00, // CRC-32
      0x00, 0x00, 0x00, 0x00, // Compressed size
      0x00, 0x00, 0x00, 0x00, // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)

      // File Name
      0x61, 0x2e, 0x74, 0x78, 0x74,

      // File Contents
      0x03, 0x00,

      // Optional Data Descriptor
      0x50, 0x4b, 0x07, 0x08, // optional data descriptor signature
      0x00, 0x00, 0x00, 0x00, // crc-32
      0x02, 0x00, 0x00, 0x00, // compressed size
      0x00, 0x00, 0x00, 0x00, // uncompressed size

      // Local File Header (#1)
      0x50, 0x4b, 0x03, 0x04, // Local file header signature
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x26, 0x83,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x00, 0x00, 0x00, 0x00, // CRC-32
      0x00, 0x00, 0x00, 0x00, // Compressed size
      0x00, 0x00, 0x00, 0x00, // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)

      // File Name
      0x62, 0x2e, 0x74, 0x78, 0x74,

    ])},

    // File Contents
    {label: "the big file contents", length: theBigCompressedSize, slice: function(start, end) {
      //console.log("slice(0x" + start.toString(16) + "..0x" + end.toString(16) + ")");
      var localStart = start - this.start;
      var localEnd = end - this.start;
      return sliceDeflatedZeros(theBigUncompressedSize, localStart, localEnd);
    }},

    {label: "unimporant stuff", buffer: bufferFromArray([
      // Optional Data Descriptor
      0x50, 0x4b, 0x07, 0x08, // optional data descriptor signature
      0x20, 0x30, 0x3a, 0x36, // crc-32
      mauCS[0], mauCS[1], mauCS[2], mauCS[3], // compressed size
      mauUS[0], mauUS[1], mauUS[2], mauUS[3], // uncompressed size
    ])},

    {label: "local file header #2", buffer: bufferFromArray([
      // Local File Header (#2)
      0x50, 0x4b, 0x03, 0x04, // Local file header signature
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x5a, 0x7c,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x00, 0x00, 0x00, 0x00, // CRC-32
      0x00, 0x00, 0x00, 0x00, // Compressed size
      0x00, 0x00, 0x00, 0x00, // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)

      // File Name
      0x63, 0x2e, 0x74, 0x78, 0x74,

      // File Contents
      0x03, 0x00,

      // Optional Data Descriptor
      0x50, 0x4b, 0x07, 0x08, // optional data descriptor signature
      0x00, 0x00, 0x00, 0x00, // crc-32
      0x02, 0x00, 0x00, 0x00, // compressed size
      0x00, 0x00, 0x00, 0x00, // uncompressed size
    ])},

    {label: "central directory", buffer: bufferFromArray([
      // Central Directory Entry (#0)
      0x50, 0x4b, 0x01, 0x02, // Central directory file header signature
      0x3f, 0x03,             // Version made by
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x5a, 0x7c,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x00, 0x00, 0x00, 0x00, // CRC-32
      0x02, 0x00, 0x00, 0x00, // Compressed size
      0x00, 0x00, 0x00, 0x00, // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)
      0x00, 0x00,             // File comment length (k)
      0x00, 0x00,             // Disk number where file starts
      0x00, 0x00,             // Internal file attributes
      0x00, 0x00, 0xb4, 0x81, // External file attributes
      0x00, 0x00, 0x00, 0x00, // Relative offset of local file header
      // File name
      0x61, 0x2e, 0x74, 0x78, 0x74,

      // Central Directory Entry (#1)
      0x50, 0x4b, 0x01, 0x02, // Central directory file header signature
      0x3f, 0x03,             // Version made by
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x26, 0x83,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x20, 0x30, 0x3a, 0x36, // CRC-32
      mauCS[0], mauCS[1], mauCS[2], mauCS[3], // Compressed size
      mauUS[0], mauUS[1], mauUS[2], mauUS[3], // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)
      0x00, 0x00,             // File comment length (k)
      0x00, 0x00,             // Disk number where file starts
      0x00, 0x00,             // Internal file attributes
      0x00, 0x00, 0xb4, 0x81, // External file attributes
      0x35, 0x00, 0x00, 0x00, // Relative offset of local file header
      // File name
      0x62, 0x2e, 0x74, 0x78, 0x74,

      // Central Directory Entry (#2)
      0x50, 0x4b, 0x01, 0x02, // Central directory file header signature
      0x3f, 0x03,             // Version made by
      0x14, 0x00,             // Version needed to extract (minimum)
      0x08, 0x08,             // General purpose bit flag
      0x08, 0x00,             // Compression method
      0x5a, 0x7c,             // File last modification time
      0x8e, 0x4e,             // File last modification date
      0x00, 0x00, 0x00, 0x00, // CRC-32
      0x02, 0x00, 0x00, 0x00, // Compressed size
      0x00, 0x00, 0x00, 0x00, // Uncompressed size
      0x05, 0x00,             // File name length (n)
      0x00, 0x00,             // Extra field length (m)
      0x00, 0x00,             // File comment length (k)
      0x00, 0x00,             // Disk number where file starts
      0x00, 0x00,             // Internal file attributes
      0x00, 0x00, 0xb4, 0x81, // External file attributes
      mau2O[0], mau2O[1], mau2O[2], mau2O[3], // Relative offset of local file header
      // File name
      0x63, 0x2e, 0x74, 0x78, 0x74,
    ])},

    {label: "eocdr", buffer: bufferFromArray([
      // End of central directory record
      0x50, 0x4b, 0x05, 0x06, // End of central directory signature
      0x00, 0x00,             // Number of this disk
      0x00, 0x00,             // Disk where central directory starts
      0x03, 0x00,             // Number of central directory records on this disk
      0x03, 0x00,             // Total number of central directory records
      0x99, 0x00, 0x00, 0x00, // Size of central directory (bytes)
      mauEO[0], mauEO[1], mauEO[2], mauEO[3], // Offset of start of central directory, relative to start of archive
      0x00, 0x00,             // Comment Length
    ])},
  ];
  var reader = new ReadBasedRandomAccessReader();
  reader.read = makeSegmentedReadFunction(segments);

  yauzl.fromRandomAccessReader(reader, segments[segments.length - 1].end, {lazyEntries: true}, function(err, zipfile) {
    if (err) throw err;
    if (zipfile.entryCount !== 3) throw new Error("wrong number of entries");
    setImmediate(function() {zipfile.readEntry();});
    zipfile.on("entry", function(entry) {
      if (err) throw err;
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        if (entry.fileName !== "b.txt") {
          // should be empty
          readStream.pipe(BufferList(function(err, contents) {
            if (err) throw err;
            if (contents.length !== 0) throw new Error("expected empty contents");
            console.log("entry data verified: " + entry.fileName);
            zipfile.readEntry();
          }));
        } else {
          // should be a lot of zeros
          var asserterStream = makeZeroAsserterSink(theBigUncompressedSize);
          asserterStream.on("finish", function() {
            console.log("entry data verified: " + entry.fileName);
            zipfile.readEntry();
          });
          readStream.pipe(asserterStream);
        }
      });
    });
    zipfile.on("end", function() {
      done();
    });
  });
}

function makeZeroAsserterSink(expectedSize) {
  var asserterStream = new Writable();

  var bytesSeen = 0;
  asserterStream._write = function(chunk, encoding, callback) {
    bytesSeen += chunk.length;
    if (bytesSeen > expectedSize) throw new Error("too many bytes");
    if (!bufferIsAllZero(chunk)) throw new Error("expected to get all zeros");
    callback();
  };
  asserterStream._final = function(callback) {
    if (bytesSeen < expectedSize) throw new Error("not enough bytes");
    callback();
  };
  return asserterStream;
}

var justZeros = newBuffer(0xffff, 0);
function sliceDeflatedZeros(totalUncompressedSize, start, end) {
  // Represents a sequence of DEFLATE "uncompressed blocks" storing zeros.
  // https://www.ietf.org/rfc/rfc1951.txt

  var blockSize = 0xffff + 5;
  var blockStartIndex = Math.floor(start / blockSize);
  var blockEndIndex = Math.max(0, Math.ceil(end / blockSize) - 1);
  var lastBlockIndex = Math.max(0, Math.ceil(totalUncompressedSize / 0xffff) - 1);

  var resultBlockSlices = [];
  for (var i = blockStartIndex; i <= blockEndIndex; i++) {
    var block;
    if (i < lastBlockIndex) {
      // not final block
      var header = bufferFromArray([
        0, // BFINAL=0, BTYPE=0
        0xff, 0xff, // LEN
        0x00, 0x00, // NLEN
      ]);
      block = Buffer.concat([header, justZeros]);
    } else {
      // last block
      var header = bufferFromArray([
        1, // BFINAL=1, BTYPE=0
        0, 0, // filled in below
        0, 0, // filled in below
      ]);
      var lastBlockLen = totalUncompressedSize - lastBlockIndex * 0xffff
      header.writeUInt16LE(lastBlockLen, 1);
      header.writeUInt16LE(0xffff & ~lastBlockLen, 3);
      block = Buffer.concat([header, justZeros.slice(0, lastBlockLen)]);
    }

    // now respect the passed in bounds
    var blockOffset = i * blockSize;
    block = block.slice(Math.max(0, start - blockOffset), end - blockOffset);
    resultBlockSlices.push(block);
  }
  return Buffer.concat(resultBlockSlices);
}

function makeSegmentedReadFunction(segments) {
  // precompute segments metadata
  var cursor = 0;
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].start == null) {
      segments[i].start = cursor;
    } else if (segments[i].start !== cursor) throw new Error("bad segment start: " + i);
    if (segments[i].buffer != null) {
      if (segments[i].end == null) {
        segments[i].end = cursor + segments[i].buffer.length;
      } else if (segments[i].end !== cursor + segments[i].buffer.length) throw new Error("bad segment length: " + i);
    } else {
      if (segments[i].end == null) {
        segments[i].end = cursor + segments[i].length;
      } else if (segments[i].end !== cursor + segments[i].length) throw new Error("bad segment length: " + i);
    }
    cursor = segments[i].end;
    console.log("segment[" + i + "]: 0x" + segments[i].start.toString(16) +
      "..0x" + segments[i].end.toString(16) + " // " + segments[i].label);
  }

  return function read(buffer, offset, length, position, callback) {
    //console.log("read(0x" + position.toString(16) + "..0x" + (position + length).toString(16) + ")");
    // why even have parameters for `offset` and `length`?
    buffer = buffer.slice(offset, offset + length);
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (position + length <= segment.start || segment.end <= position) continue;
      // this segment contributes something
      if (segment.buffer != null) {
        // direct copy
        var bytesCopied = segment.buffer.copy(buffer,
          Math.max(0, segment.start - position),
          Math.max(0, position - segment.start));
        buffer = buffer.slice(bytesCopied);
        position += bytesCopied;
      } else {
        var buf = segment.slice(position, Math.min(position + buffer.length, segment.end));
        var bytesCopied = buf.copy(buffer)
        buffer = buffer.slice(bytesCopied);
        position += bytesCopied;
      }
      if (buffer.length === 0) {
        return setImmediate(function() {
          callback(null, length);
        });
      }
    }
    console.log("WARNING: causing unexpected EOF");
    return callback(null, length - buffer.length);
  };
}

// TODO: this class could probably be exported by yauzl proper.
util.inherits(ReadBasedRandomAccessReader, yauzl.RandomAccessReader);
function ReadBasedRandomAccessReader() {
  yauzl.RandomAccessReader.call(this);
}
ReadBasedRandomAccessReader.prototype._readStreamForRange = function(start, end) {
  var selfReader = this;
  var stream = new Readable();
  var bytesRead = 0;
  var readInProgress = false;
  stream._read = function(size) {
    if (readInProgress) {
      // wtf node! don't call me twice at once!
      // how is this acceptable? this isn't even documented!
      return;
    }
    readInProgress = true;

    //size = (0xffff + 5) * 2 - 2;
    var selfStream = this;
    pump();
    function pump() {
      var readStart = start + bytesRead;
      var readSize = Math.min(size, end - readStart);
      if (readSize <= 0) {
        readInProgress = false;
        return selfStream.push(null);
      }
      //console.log("readSize: 0x" + readSize.toString(16));
      var buffer = newBuffer(readSize, 0);
      selfReader.read(buffer, 0, readSize, readStart, function(err, actualReadSize) {
        if (err) return selfStream.emit("error", err);
        if (readSize !== actualReadSize) throw new Error("unexpected eof");
        bytesRead += readSize;
        if (!selfStream.push(buffer)) {
          readInProgress = false;
          return;
        }
        pump();
      });
    }
  };
  return stream;
};
ReadBasedRandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
  throw new Error("not implemented");
};

function bufferIsAllZero(buffer) {
  for (var i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) return false;
  }
  return true;
}
function buffersEqual(a, b) {
  // Buffer.equals was added in v0.11.13, and we need to support v0.10
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

if (require.main === module) cli();
