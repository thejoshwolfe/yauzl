// Demonstrates the `this` vs `self` slip on line 90 of fd-slicer.js (3.3.1).
//
// In `ReadStream.prototype._read`, the EOF branch reached via `fs.read`
// returning bytesRead === 0 calls `this._cleanup()`. Inside an `fs.read`
// callback, `this` is the global object (yauzl runs in CJS sloppy mode —
// no 'use strict' directive), not the ReadStream. The rest of the same
// function correctly uses `self.<...>`; the `_cleanup` call is the sole
// exception.
//
// To reach that branch we need:
//   - endOffset set BEYOND the actual file length (so the precomputed
//     `toRead <= 0` branch never fires),
//   - fs.read issued at pos == file length, returning bytesRead === 0.
//
// The normal yauzl flow (openReadStream on a zip entry) sets endOffset
// to exactly the entry's compressed size, so it never reaches this branch
// — which is why the existing test suite doesn't surface the bug. Direct
// FdSlicer.createReadStream() with a too-large `end` reaches it.

const fs = require('fs');
const path = require('path');
const os = require('os');
const FdSlicer = require('../fd-slicer.js').FdSlicer;

const TEST_FILE = path.join(os.tmpdir(), 'yauzl-bug-this-cleanup.bin');
const CONTENT = Buffer.from('hello world'); // 11 bytes
fs.writeFileSync(TEST_FILE, CONTENT);

const fd = fs.openSync(TEST_FILE, 'r');
const slicer = new FdSlicer(fd);

// `end: 1000` means endOffset = 1000, but the file is only 11 bytes.
// After consuming 11 bytes, the next _read computes
//   toRead = min(highWaterMark, 1000 - 11) > 0
// so the `toRead <= 0` branch is skipped. fs.read is issued at pos = 11,
// returns bytesRead === 0, and the buggy line fires.
const stream = slicer.createReadStream({ start: 0, end: 1000 });

let totalBytes = 0;

function report(kind, detail) {
  console.log('--- result ---');
  console.log('kind:    ' + kind);
  console.log('detail:  ' + detail);
  console.log('bytes:   ' + totalBytes + ' (file content was ' + CONTENT.length + ')');
  console.log('--------------');
}

// The throw happens inside fs.read's callback. Depending on Node's wiring
// it can surface as a stream 'error' OR as an uncaughtException. We catch
// both to make the repro robust.
process.on('uncaughtException', function(err) {
  if (/_cleanup is not a function/.test(err.message)) {
    report('BUG REPRODUCED (uncaughtException)', err.message);
    process.exit(0);
  }
  report('uncaughtException (unrelated)', err.stack || err.message);
  process.exit(2);
});

stream.on('data', function(chunk) {
  totalBytes += chunk.length;
});

stream.on('error', function(err) {
  if (/_cleanup is not a function/.test(err.message)) {
    report('BUG REPRODUCED (stream error)', err.message);
    process.exit(0);
  }
  report('stream error (unrelated)', err.message);
  process.exit(2);
});

stream.on('end', function() {
  report('stream ended cleanly — bug did NOT fire', 'see comments above for trigger condition');
  process.exit(1);
});

setTimeout(function() {
  report('timeout', 'stream neither ended nor errored after 5s');
  process.exit(3);
}, 5000);
