var zlib = require("zlib");
var Writable = require("stream").Writable;
var Readable = require("stream").Readable;

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
  var uncompressedSized = 2 ** 32 + 2;
  // test sparse gzip code
  var fakeReadStream = createDeflatedZeros(uncompressedSized);
  var inflateFilter = zlib.createInflateRaw();
  var asserterStream = new Writable();


  var bytesSeen = 0;
  asserterStream._write = function(chunk, encoding, callback) {
    bytesSeen += chunk.length;
    if (bytesSeen > uncompressedSized) throw new Error("too many bytes");
    if (!bufferIsAllZero(chunk)) throw new Error("expected to get all zeros");
    callback();
  };
  asserterStream._final = function(callback) {
    if (bytesSeen < uncompressedSized) throw new Error("not enough bytes");
    callback();
  };

  fakeReadStream.pipe(inflateFilter).pipe(asserterStream);
}

var justZeros = newBuffer(0xffff, 0);
function createDeflatedZeros(uncompressedSized) {
  // Produces a stream of DEFLATE blocks of uncompressed zeros.
  // https://www.ietf.org/rfc/rfc1951.txt
  var stream = new Readable();
  var servedBytes = 0;
  stream._read = function() {
    while (true) {
      var remainingBytes = uncompressedSized - servedBytes;
      if (remainingBytes > 0xffff) {
        servedBytes += 0xffff;
        var header = bufferFromArray([
          0, // BFINAL=0, BTYPE=0
          0xff, 0xff, // LEN
          0x00, 0x00, // NLEN
        ]);
        if (!stream.push(Buffer.concat([header, justZeros]))) return;
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
        stream.push(Buffer.concat([header, justZeros.slice(0, remainingBytes)]));
        stream.push(null);
        return;
      }
    }
  };
  return stream;
}

function bufferIsAllZero(buffer) {
  for (var i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) return false;
  }
  return true;
}

if (require.main === module) cli();
