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

function testCrowdedFile(cb) {
  // TODO
  cb();
}

function testBigFile(cb) {
  // TODO
  cb();
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
    var selfStream = this;
    pump();
    function pump() {
      var readStart = start + bytesRead;
      var readSize = Math.min(size, end - readStart);
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
