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
  testSparseGzip(function() {
    testStartOffset(function() {
      testBigFile(function() {
        testCrowdedFile(function() {
          console.log("done");
        });
      });
    });
  });
}

function testCrowdedFile(done) {
  // TODO
  done();
}

function testBigFile(done) {
  var segments = [
    {buffer: bufferFromArray([
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

    {length: 8, slice: function(start, end) {
      // File Contents TODO: replace with large data
      console.log("slice", start, end);
      var localStart = start - this.start;
      var localEnd = end - this.start;
      return sliceDeflatedZeros(3, localStart, localEnd);
    }},

    {buffer: bufferFromArray([
      // Optional Data Descriptor
      0x50, 0x4b, 0x07, 0x08, // optional data descriptor signature
      0x20, 0x30, 0x3a, 0x36, // crc-32
      0x08, 0x00, 0x00, 0x00, // compressed size TODO
      0x06, 0x00, 0x00, 0x00, // uncompressed size TODO

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

    {buffer: bufferFromArray([
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
      0x08, 0x00, 0x00, 0x00, // Compressed size TODO
      0x03, 0x00, 0x00, 0x00, // Uncompressed size TODO
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
      0x70, 0x00, 0x00, 0x00, // Relative offset of local file header TODO
      // File name
      0x63, 0x2e, 0x74, 0x78, 0x74,
    ])},

    {buffer: bufferFromArray([
      // End of central directory record
      0x50, 0x4b, 0x05, 0x06, // End of central directory signature
      0x00, 0x00,             // Number of this disk
      0x00, 0x00,             // Disk where central directory starts
      0x03, 0x00,             // Number of central directory records on this disk
      0x03, 0x00,             // Total number of central directory records
      0x99, 0x00, 0x00, 0x00, // Size of central directory (bytes)
      0xa5, 0x00, 0x00, 0x00, // Offset of start of central directory, relative to start of archive
      0x00, 0x00,             // Comment Length
    ])},
  ];
  var reader = new ReadBasedRandomAccessReader();
  reader.read = makeSegmentedReadFunction(segments);

  yauzl.fromRandomAccessReader(reader, segments[segments.length - 1].end, {lazyEntries: true}, function(err, zipfile) {
    if (err) throw err;
    if (zipfile.entryCount !== 3) throw new Error("asdf");
    setImmediate(function() {zipfile.readEntry();});
    zipfile.on("entry", function(entry) {
      if (err) throw err;
      console.log("got entry: " + entry.fileName);
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        readStream.pipe(BufferList(function(err, contents) {
          if (err) throw err;
          var expectedContents = entry.fileName === "b.txt" ? bufferFromArray([0,0,0]) : bufferFromArray([]);
          if (!buffersEqual(expectedContents, contents)) throw new Error("wrong contents");
          console.log("entry data verified");
          zipfile.readEntry();
        }));
      });
    });
    zipfile.on("end", function() {
      done();
    });
  });
}

function testStartOffset(cb) {
  var uncompressedSize = 0xffff * 3 + 1;
  createDeflatedZeros(uncompressedSize, 0).pipe(BufferList(function(err, expectedCompleteBuffer) {
    if (err) throw err;
    // if we start in the middle, we should get a slice of the complete buffer
    var started = 0;
    var done = 0;
    testTailBuffer(1, checkDone);
    testTailBuffer(2, checkDone);
    testTailBuffer(3, checkDone);
    testTailBuffer(4, checkDone);
    testTailBuffer(5, checkDone);
    testTailBuffer(6, checkDone);
    testTailBuffer(0xffff, checkDone);
    testTailBuffer(0xffff + 11, checkDone);

    function testTailBuffer(tailSize, cb) {
      started++;
      createDeflatedZeros(uncompressedSize, uncompressedSize - tailSize).pipe(BufferList(function(err, tailBuffer) {
        if (!buffersEqual(expectedCompleteBuffer.slice(uncompressedSize - tailSize), tailBuffer)) throw new Error("wrong data");
        console.log("tail size(" + tailSize + "): pass");
        cb();
      }));
    }
    function checkDone() {
      // ugh. this would be nicer with await
      done++;
      if (done === started) cb();
    }
  }));
}

function testSparseGzip(cb) {
  var uncompressedSize = 0xffff * 5 + 10;
  var fakeReadStream = createDeflatedZeros(uncompressedSize, 0);
  var inflateFilter = zlib.createInflateRaw();
  var asserterStream = new Writable();

  var bytesSeen = 0;
  asserterStream._write = function(chunk, encoding, callback) {
    bytesSeen += chunk.length;
    if (bytesSeen > uncompressedSize) throw new Error("too many bytes");
    if (!bufferIsAllZero(chunk)) throw new Error("expected to get all zeros");
    callback();
  };
  asserterStream._final = function(callback) {
    if (bytesSeen < uncompressedSize) throw new Error("not enough bytes");
    callback();
    console.log("sparse gzip: pass");
    cb();
  };

  fakeReadStream.pipe(inflateFilter).pipe(asserterStream);
}

var justZeros = newBuffer(0xffff, 0);
function createDeflatedZeros(uncompressedSize, startOffset) {
  // Produces a stream of DEFLATE blocks of uncompressed zeros.
  // https://www.ietf.org/rfc/rfc1951.txt
  var servedBytes = 0;
  while (startOffset >= 5 + 0xffff) {
    // skip entire blocks
    servedBytes += 0xffff;
    startOffset -= 5 + 0xffff;
  }

  function sliceFirstBuffer(buffer) {
    if (startOffset === 0) return buffer;
    buffer = buffer.slice(startOffset);
    startOffset = 0;
    return buffer;
  }

  var stream = new Readable();
  stream._read = function() {
    while (true) {
      var remainingBytes = uncompressedSize - servedBytes;
      if (remainingBytes > 0xffff) {
        servedBytes += 0xffff;
        var header = bufferFromArray([
          0, // BFINAL=0, BTYPE=0
          0xff, 0xff, // LEN
          0x00, 0x00, // NLEN
        ]);
        if (!stream.push(sliceFirstBuffer(Buffer.concat([header, justZeros])))) return;
      } else {
        // last block
        servedBytes += remainingBytes;
        var header = bufferFromArray([
          1, // BFINAL=1, BTYPE=0
          0, 0, // filled in below
          0, 0, // filled in below
        ]);
        header.writeUInt16LE(remainingBytes, 1);
        header.writeUInt16LE(0xffff & ~remainingBytes, 3);
        stream.push(sliceFirstBuffer(Buffer.concat([header, justZeros.slice(0, remainingBytes)])));
        stream.push(null);
        return;
      }
    }
  };
  return stream;
}

function sliceDeflatedZeros(totalUncompressedSize, start, end) {
  // Represents a sequence of DEFLATE "uncompressed blocks" storing zeros.
  // https://www.ietf.org/rfc/rfc1951.txt

  var blockSize = 0xffff + 5;
  var blockStartIndex = Math.floor(start / blockSize);
  var blockEndIndex = Math.floor(end / blockSize);
  var lastBlockIndex = Math.floor(totalUncompressedSize / 0xffff);

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
    resultBlockSlices.push(block.slice(Math.max(0, start - blockOffset), end - blockOffset));
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
  }

  return function read(buffer, offset, length, position, callback) {
    console.log("read(0x" + position.toString(16) + "..0x" + (position + length).toString(16) + ")");
    // why even have parameters for `offset` and `length`?
    buffer = buffer.slice(offset, offset + length);
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (position + length <= segment.start || segment.end <= position) continue;
      //console.log("segment:", i); // TODO: tmp debugging
      // this segment contributes something
      if (segment.buffer != null) {
        // direct copy
        var bytesCopied = segment.buffer.copy(buffer,
          Math.max(0, segment.start - position),
          Math.max(0, position - segment.start));
        buffer = buffer.slice(bytesCopied);
        position += bytesCopied;

        if (buffer.length === 0) return callback();
      } else {
        var buf = segment.slice(position, position + Math.min(buffer.length, segment.length));
        var bytesCopied = buf.copy(buffer)
        buffer = buffer.slice(bytesCopied);
        position += bytesCopied;

        if (buffer.length === 0) return callback();
      }
    }
    throw new Error("nothing left to read");
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
  stream._read = function(size) {
    size = 3; // TODO: tmp
    var selfStream = this;
    pump();
    function pump() {
      var readStart = start + bytesRead;
      var readSize = Math.min(size, end - readStart);
      console.log("readSize:", readSize); // TODO: debugging
      if (readSize <= 0) {
        return selfStream.push(null);
      }
      var buffer = newBuffer(readSize, 0);
      selfReader.read(buffer, 0, readSize, readStart, function(err) {
        if (err) return selfStream.emit("error", err);
        bytesRead += readSize;
        if (selfStream.push(buffer)) pump();
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
