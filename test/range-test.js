var yauzl = require("../");
var PassThrough = require("stream").PassThrough;
var util = require("util");
var Pend = require("pend");
var BufferList = require("bl");

exports.runTest = runTest;

// zipfile obtained via:
//  $ echo -n 'aaabaaabaaabaaab' > stored.txt
//  $ cp stored.txt compressed.txt
//  $ cp stored.txt encrypted.txt
//  $ cp stored.txt encrypted-and-compressed.txt
//  $ rm -f out.zip
//  $ zip out.zip -0 stored.txt
//  $ zip out.zip compressed.txt
//  $ zip out.zip -e0 encrypted.txt
//  $ zip out.zip -e encrypted-and-compressed.txt
var zipfileBuffer = hexToBuffer("" +
  "504b03040a00000000006a54954ab413389510000000100000000a001c007374" +
  "6f7265642e7478745554090003d842fa5842c5f75875780b000104e803000004" +
  "e803000061616162616161626161616261616162504b03041400000008007554" +
  "954ab413389508000000100000000e001c00636f6d707265737365642e747874" +
  "5554090003ed42fa58ed42fa5875780b000104e803000004e80300004b4c4c4c" +
  "4a44c200504b03040a00090000008454954ab41338951c000000100000000d00" +
  "1c00656e637279707465642e74787455540900030743fa580743fa5875780b00" +
  "0104e803000004e8030000f72e7bb915142131c934f01b163fcadb2a8db7cdaf" +
  "d0a6f4dd1694c0504b0708b41338951c00000010000000504b03041400090008" +
  "008a54954ab413389514000000100000001c001c00656e637279707465642d61" +
  "6e642d636f6d707265737365642e74787455540900031343fa581343fa587578" +
  "0b000104e803000004e80300007c4d3ea0d9754b470d3eb32ada5741bfc848f4" +
  "19504b0708b41338951400000010000000504b01021e030a00000000006a5495" +
  "4ab413389510000000100000000a0018000000000000000000b4810000000073" +
  "746f7265642e7478745554050003d842fa5875780b000104e803000004e80300" +
  "00504b01021e031400000008007554954ab413389508000000100000000e0018" +
  "000000000001000000b48154000000636f6d707265737365642e747874555405" +
  "0003ed42fa5875780b000104e803000004e8030000504b01021e030a00090000" +
  "008454954ab41338951c000000100000000d0018000000000000000000b481a4" +
  "000000656e637279707465642e74787455540500030743fa5875780b000104e8" +
  "03000004e8030000504b01021e031400090008008a54954ab413389514000000" +
  "100000001c0018000000000001000000b48117010000656e637279707465642d" +
  "616e642d636f6d707265737365642e74787455540500031343fa5875780b0001" +
  "04e803000004e8030000504b0506000000000400040059010000910100000000" +
"");
// the same file in all 4 supported forms:
// [0b00]: stored
// [0b01]: compressed
// [0b10]: encrypted
// [0b11]: encrypted and compressed
function shouldBeCompressed(index) { return (index & 1) !== 0; }
function shouldBeEncrypted (index) { return (index & 2) !== 0; }
var expectedFileDatas = [
  hexToBuffer("61616162616161626161616261616162"),
  hexToBuffer("4b4c4c4c4a44c200"),
  hexToBuffer("f72e7bb915142131c934f01b163fcadb2a8db7cdafd0a6f4dd1694c0"),
  hexToBuffer("7c4d3ea0d9754b470d3eb32ada5741bfc848f419"),
];

function runTest(cb) {
  util.inherits(StingyRandomAccessReader, yauzl.RandomAccessReader);
  function StingyRandomAccessReader(buffer) {
    yauzl.RandomAccessReader.call(this);
    this.buffer = buffer;
    this.upcomingByteCounts = [];
  }
  StingyRandomAccessReader.prototype._readStreamForRange = function(start, end) {
    if (this.upcomingByteCounts.length > 0) {
      var expectedByteCount = this.upcomingByteCounts.shift();
      if (expectedByteCount != null) {
        if (expectedByteCount !== end - start) {
          throw new Error("expected " + expectedByteCount + " got " + (end - start) + " bytes");
        }
      }
    }
    var result = new PassThrough();
    result.write(this.buffer.slice(start, end));
    result.end();
    return result;
  };

  var zipfileReader = new StingyRandomAccessReader(zipfileBuffer);
  var options = {lazyEntries: true, autoClose: false};
  yauzl.fromRandomAccessReader(zipfileReader, zipfileBuffer.length, options, function(err, zipfile) {
    var entries = [];
    zipfile.readEntry();
    zipfile.on("entry", function(entry) {
      var index = entries.length;
      // asser the structure of the zipfile is what we expect
      if (entry.isCompressed() !== shouldBeCompressed(index)) throw new Error("assertion failure");
      if (entry.isEncrypted()  !== shouldBeEncrypted(index))  throw new Error("assertion failure");
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.on("end", function() {
      // now we get to the testing

      var pend = new Pend();
      // 1 thing at a time for better determinism/reproducibility
      pend.max = 1;

      [null, 0, 2].forEach(function(start) {
        [null, 3, 5].forEach(function(end) {
          entries.forEach(function(entry, index) {
            var expectedFileData = expectedFileDatas[index];
            pend.go(function(cb) {
              var effectiveStart = start != null ? start : 0;
              var effectiveEnd = end != null ? end : expectedFileData.length;
              var expectedSlice = expectedFileData.slice(effectiveStart, effectiveEnd);
              // the next read will be to check the local file header.
              // then we assert that yauzl is asking for just the bytes we asked for.
              zipfileReader.upcomingByteCounts = [null, expectedSlice.length];

              var options = {};
              if (start != null) options.start = start;
              if (end != null) options.end = end;
              if (entry.isCompressed()) options.decompress = false;
              if (entry.isEncrypted()) options.decrypt = false;
              zipfile.openReadStream(entry, options, function(err, readStream) {
                if (err) throw err;
                readStream.pipe(BufferList(function(err, data) {
                  var prefix = "openReadStream with range(" + start + "," + end + "," + index + "): ";
                  if (!buffersEqual(data, expectedSlice)) {
                    throw new Error(prefix + "contents mismatch");
                  }
                  console.log(prefix + "pass");
                  cb();
                }));
              });
            });
          });
        });
      });
      pend.wait(cb);
    });
  });
}

function hexToBuffer(hexString) {
  var buffer = new Buffer(hexString.length / 2);
  for (var i = 0; i < buffer.length; i++) {
    buffer[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return buffer;
}

function buffersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

if (require.main === module) runTest(function() {});
