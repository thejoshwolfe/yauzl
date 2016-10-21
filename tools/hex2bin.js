// This is a tool independent of the yauzl library.
// This tool is meant to read a file produced by hexdump-zip.js
// and convert it back into a binary file.
var util = require("util");
var Transform = require("stream").Transform;

// TODO: add line and column numbers to errors.

// Usage:
// node hex2bin.js < inputfile > outputfile

// This tool reads a hexdump "language" documented here:

// The input file is interpreted as a sequence of tokens.
// Tokens can be any of the following constructs:

// Comments begin with ';' and last to the next '\n' character.
// Comments match this pattern:
var commentPattern = /;[^\n]*/;

// Whitespace is any character matching this pattern:
var whitespacePattern = /[ \n\r\t]/;

// Data is encoded in hex bytes.
// Each hex byte is two consecutive hex characters matching this pattern:
var hexBytePattern = /[0-9A-Fa-f]{2}/;
// There can be any amount of whitespace and comments between hex bytes,
// but not between the two characters of a hex byte.
// When a hex byte is encountered, a byte is emitted to the output whose value is processed by this function:
function hexByteToByteValue(textByteText) {
  return parseInt(textByteText, 16);
}

// Offset assertions begin with a ':' and are terminated by whitespace or a comment.
// The text after a ':' must be a C-style hex literal.
// The total offset assertion must match this pattern:
var offsetAssertionPattern = /:0[xX][0-9A-Fa-f]+/;
// When an offset assertion is encounted, the total number of bytes output so far
// must be equal to the value given in the offset assertion as interpreted by this function:
function offsetAssertionTextToOffsetValue(offsetAssertionText) {
  return parseInt(offsetAssertionText.substr(3), 16);
}


var COMMENT = 1;
var WHITESPACE = 2;
var HEX_BYTE = 3;
var OFFSET_ASSERTION = 4;
var INVALID = 5;
var masterPattern = new RegExp([
  [COMMENT, commentPattern],
  [WHITESPACE, whitespacePattern],
  [HEX_BYTE, hexBytePattern],
  [OFFSET_ASSERTION, offsetAssertionPattern],
  [INVALID, /[^]/],
].map(function(pair, i) {
  if (i !== pair[0] - 1) throw new Error();
  return "(" + pair[1].source + ")";
}).join("|"), "g");


function main() {
  util.inherits(Hex2binTransform, Transform);
  function Hex2binTransform(byteCount) {
    Transform.call(this);
    this.accumulator = "";
    this.done = false;
    this.offset = 0;
  }
  Hex2binTransform.prototype._transform = function(chunk, encoding, cb) {
    this.accumulator += chunk.toString();
    this.doSomeProcessing(cb);
  };
  Hex2binTransform.prototype._flush = function(cb) {
    this.done = true;
    this.doSomeProcessing(cb);
  };
  Hex2binTransform.prototype.doSomeProcessing = function(cb) {
    var self = this;
    var outBuffer = new Buffer(0x100);
    var outBufferCursor = 0;
    var outBuffers = [];
    function writeByte(b) {
      if (outBufferCursor === outBuffer.length) {
        outBuffers.push(outBuffer);
        outBuffer = new Buffer(0x1000);
        outBufferCursor = 0;
      }
      outBuffer[outBufferCursor++] = b;
      self.offset++;
    }
    var cursor = 0;
    // stay about 100 away from the end of the stream to avoid tokens that span chunk seams
    while (cursor < (self.done ? self.accumulator.length : self.accumulator.length - 0x100)) {
      masterPattern.lastIndex = cursor;
      var match = masterPattern.exec(self.accumulator);
      if (match.index !== cursor) throw new Error("pattern skipped something?");
      var tokenEndsAtChunkEnd = cursor + match[0].length === self.accumulator.length;
      var tokenText;
      if (tokenText = match[COMMENT]) {
        if (!self.done && tokenEndsAtChunkEnd) {
          // don't trust line comments that end at the chunk seam.
          // try again when we have more data.
          break;
        }
        // ignore
      } else if (tokenText = match[WHITESPACE]) {
        // ignore
      } else if (tokenText = match[HEX_BYTE]) {
        writeByte(hexByteToByteValue(tokenText));
      } else if (tokenText = match[OFFSET_ASSERTION]) {
        if (!self.done && tokenEndsAtChunkEnd) {
          // don't trust offset assertions that end at the chunk seam.
          break;
        }
        var expected = offsetAssertionTextToOffsetValue(tokenText);
        if (self.offset !== expected) {
          throw new Error("unexpected offset. claimed: 0x" + expected.toString(16) + ". actual: 0x" + self.offset.toString(16));
        }
      } else if (tokenText = match[INVALID]) {
        throw new Error("invalid character at output offset 0x" + self.offset.toString(16));
      } else {
        throw new Error("what capture group did we hit?");
      }
      cursor += tokenText.length;
    }
    self.accumulator = self.accumulator.substr(cursor);
    outBuffers.push(outBuffer.slice(0, outBufferCursor));
    self.push(Buffer.concat(outBuffers));
    cb();
  };

  process.stdin.pipe(new Hex2binTransform()).pipe(process.stdout);
}


main();
