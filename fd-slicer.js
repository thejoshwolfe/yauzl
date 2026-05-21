// This was adapted from https://github.com/andrewrk/node-fd-slicer by Andrew Kelley under the MIT License.
var fs = require('fs');
var util = require('util');
var stream = require('stream');
var Readable = stream.Readable;
var PassThrough = stream.PassThrough;
var Pend = require('pend');
var EventEmitter = require('events').EventEmitter;

exports.BufferSlicer = BufferSlicer;
exports.FdSlicer = FdSlicer;

util.inherits(FdSlicer, EventEmitter);
function FdSlicer(fd) {
  EventEmitter.call(this);

  this.fd = fd;
  this.pend = new Pend();
  this.pend.max = 1;
  this.refCount = 0;
}

FdSlicer.prototype.read = function(buffer, offset, length, position, callback) {
  var self = this;
  self.pend.go(function(cb) {
    fs.read(self.fd, buffer, offset, length, position, function(err, bytesRead, buffer) {
      cb();
      callback(err, bytesRead, buffer);
    });
  });
};

FdSlicer.prototype.createReadStream = function(options) {
  return new ReadStream(this, options);
};

FdSlicer.prototype.ref = function() {
  this.refCount += 1;
};

FdSlicer.prototype.unref = function() {
  var self = this;
  self.refCount -= 1;
  if (self.refCount < 0) throw new Error("invalid unref");
  if (self.refCount > 0) return;

  fs.close(self.fd, onCloseDone);

  function onCloseDone(err) {
    if (err) {
      self.emit('error', err);
    } else {
      self.emit('close');
    }
  }
};

util.inherits(ReadStream, Readable);
function ReadStream(context, options) {
  options = options || {};
  Readable.call(this, options);

  this.context = context;
  this.context.ref();

  this.start = options.start || 0;
  this.endOffset = options.end;
  this.pos = this.start;
}

ReadStream.prototype._read = function(n) {
  var self = this;

  var toRead = Math.min(self._readableState.highWaterMark, n);
  if (self.endOffset != null) {
    toRead = Math.min(toRead, self.endOffset - self.pos);
  }
  if (toRead <= 0) {
    self.push(null);
    this._cleanup();
    return;
  }
  self.context.pend.go(function(cb) {
    var buffer = Buffer.allocUnsafe(toRead);
    fs.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
      if (err) {
        self.destroy(err);
      } else if (bytesRead === 0) {
        self.push(null);
        this._cleanup();
      } else {
        self.pos += bytesRead;
        self.push(buffer.slice(0, bytesRead));
      }
      cb();
    });
  });
};

ReadStream.prototype._destroy = function(err, cb) {
  // Node 14+ calls this automatically at EOF.
  this._cleanup();
  cb(err);
};

ReadStream.prototype._cleanup = function() {
  if (this.context != null) {
    this.context.unref();
    this.context = null;
  }
};

util.inherits(BufferSlicer, EventEmitter);
function BufferSlicer(buffer) {
  EventEmitter.call(this);

  this.refCount = 0;
  this.buffer = buffer;
}

BufferSlicer.prototype.read = function(buffer, offset, length, position, callback) {
  if (!(0 <= offset && offset <= buffer.length)) throw new RangeError("offset outside buffer: 0 <= " + offset + " <= " + buffer.length);
  if (position < 0) throw new RangeError("position is negative: " + position);
  if (offset + length > buffer.length) {
    // The caller's buffer can't hold all the bytes they're trying to read.
    // Clamp the length instead of giving an error.
    // The callback will be informed of fewer than expected bytes written.
    length = buffer.length - offset;
  }
  if (position + length > this.buffer.length) {
    // Clamp any attempt to read past the end of the source buffer.
    length = this.buffer.length - position;
  }
  if (length <= 0) {
    // After any clamping, we're fully out of bounds or otherwise have nothing to do.
    // This isn't an error; it's just zero bytes written.
    setImmediate(function() {
      callback(null, 0);
    });
    return;
  }
  this.buffer.copy(buffer, offset, position, position + length);
  setImmediate(function() {
    callback(null, length);
  });
};

BufferSlicer.prototype.createReadStream = function(options) {
  options = options || {};
  var readStream = new PassThrough(options);
  readStream.start = options.start || 0;
  readStream.endOffset = options.end;
  // by the time this function returns, we'll be done.
  readStream.pos = readStream.endOffset || this.buffer.length;

  var entireSlice = this.buffer.slice(readStream.start, readStream.pos);
  // Cut the buffer into smaller slices for better memory usage when streaming into a zlib inflate stream.
  // See https://github.com/thejoshwolfe/yauzl/issues/87
  var maxChunkSize = 0x10000;
  var offset = 0;
  while (true) {
    var nextOffset = offset + maxChunkSize;
    if (nextOffset >= entireSlice.length) {
      // last chunk
      if (offset < entireSlice.length) {
        readStream.write(entireSlice.slice(offset, entireSlice.length));
      }
      break;
    }
    readStream.write(entireSlice.slice(offset, nextOffset));
    offset = nextOffset;
  }

  readStream.end();
  return readStream;
};

BufferSlicer.prototype.ref = function() {
  this.refCount += 1;
};

BufferSlicer.prototype.unref = function() {
  this.refCount -= 1;

  if (this.refCount < 0) {
    throw new Error("invalid unref");
  }
};
