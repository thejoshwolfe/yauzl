// Test I/O errors coming from the random access reader at any given moment.
// The .zip file being tested has a variety of features, such as a large central directory,
// and somewhat large compressed and uncompressed files.

const yauzl = require("../");
const path = require("path");
const fs = require("fs");
const stream = require("stream");

exports.runTest = runTest;

let ArrayFromAsync = Array.fromAsync;
if (typeof ArrayFromAsync !== "function") {
  ArrayFromAsync = async function(items) {
    // This is not a general-purpose polyfill.
    // It just does enough for what we want here.
    const result = [];
    for await (let item of items) {
      result.push(item);
    }
    return result;
  };
}

class EventuallyFailRandomAccessReader extends yauzl.RandomAccessReader {
  constructor(successCount, buffer) {
    super();
    this.successCount = successCount;
    this.buffer = buffer;
  }
  isItTimeToFail() {
    if (this.successCount <= 0) return true;
    this.successCount--;
    return false;
  }
  _readStreamForRange(start, end) {
    const self = this;
    const reader = new stream.Readable();
    reader._read = function(size) {
      if (self.isItTimeToFail()) return this.emit("error", new TheErrorWeExpect("i've decided to fail now"));
      const clampedEnd = Math.min(start + size, end);
      const chunk = self.buffer.slice(start, clampedEnd);
      start = clampedEnd;
      this.push(chunk);
      if (start >= end) {
        return this.push(null); // EOF
      }
    };
    return reader;
  }
  close(cb) {
    this.buffer = null;
    cb();
  }
}

class TheErrorWeExpect extends Error {}

const stopAtEntryFileName = "a/b/020";
function runTest(cb) {
  const buffer = fs.readFileSync(path.join(__dirname, "success", "everything.zip"));

  testErrorsWithCallbacks(buffer, async function() {
    await testErrorsWithPromises(buffer);
    await testErrorsWithPromisesGreedy(buffer);
    cb();
  });
}

function testErrorsWithCallbacks(buffer, cb) {
  const prefix = "test every error with callbacks: ";
  let successCount = 0;
  giveItAGo(function handleResult(reachedEnd) {
    if (reachedEnd) return cb();
    successCount++;
    giveItAGo(handleResult);
  });

  function giveItAGo(cb) {
    function handleError(err) {
      if (err instanceof TheErrorWeExpect) return cb(false);
      throw err;
    }
    const reader = new EventuallyFailRandomAccessReader(successCount, buffer);

    yauzl.fromRandomAccessReader(reader, buffer.length, {lazyEntries:true}, function(err, zipfile) {
      if (err) return handleError(err);

      zipfile.readEntry();
      zipfile.on("error", handleError);
      zipfile.on("entry", function(entry) {
        if (entry.fileName === stopAtEntryFileName) {
          // We've seen enough. Don't need to fully process each small entry.
          return done();
        }
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) return handleError(err);
          readStream.on("error", handleError);
          const sink = new stream.Writable();
          sink._write = function(chunk, encoding, callback) {
            callback();
          };
          sink.on("finish", function() {
            zipfile.readEntry();
          });
          readStream.pipe(sink);
        });
      });
      zipfile.on("end", function() {
        throw new Error("expected to interrupt before reaching the end");
      });
      function done() {
        console.log(prefix + `done after ${successCount} read() calls`);
        cb(true);
      }
    });
  }
}

async function testErrorsWithPromises(buffer) {
  const prefix = "test every error with promises: ";
  for (var successCount = 0;; successCount++) {
    const reader = new EventuallyFailRandomAccessReader(successCount, buffer);
    try {
      const zipfile = await yauzl.fromRandomAccessReaderPromise(reader, buffer.length);
      for await (let entry of zipfile.eachEntry()) {
        if (entry.fileName == stopAtEntryFileName) break;
        const readStream = await zipfile.openReadStreamPromise(entry);
        for await (let chunk of readStream) {
          // Do nothing.
        }
      }
    } catch (err) {
      handleError(err); continue;
    }
    break;
  }
  console.log(prefix + `done after ${successCount} read() calls`);

  function handleError(err) {
    if (err instanceof TheErrorWeExpect) return;
    throw err;
  }
}

async function testErrorsWithPromisesGreedy(buffer) {
  const prefix = "test almost every error with greedy promises: ";
  for (var successCount = 0;; successCount += Math.max(1, successCount >> 2)) {
    var reader = new EventuallyFailRandomAccessReader(successCount, buffer);
    try {
      const zipfile = await yauzl.fromRandomAccessReaderPromise(reader, buffer.length, {autoClose: false});
      try {
        // All entries are read first, then all read streams are opened afterward.
        const entries = await ArrayFromAsync(zipfile.eachEntry());
        for (let entry of entries) {
          const readStream = await zipfile.openReadStreamPromise(entry);
          for await (let chunk of readStream) {
            // Do nothing.
          }
        }
      } finally {
        zipfile.close();
      }
    } catch (err) {
      handleError(err); continue;
    }
    break;
  }
  console.log(prefix + `done after ${successCount - reader.successCount} read() calls`);

  function handleError(err) {
    if (err instanceof TheErrorWeExpect) return;
    throw err;
  }
}
