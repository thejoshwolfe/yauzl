var yauzl = require("../");
var PassThrough = require("stream").PassThrough;
var util = require("util");
var Pend = require("pend");
var BufferList = require("bl");

exports.runTest = runTest;

// zipfile obtained via:
//  <convert hex buffer in range-test.js into range-test.zip>
//  $ rm -f stored.zip compressed.zip encrypted.zip encrypted-and-compressed.zip
//  $ cp range-test.zip stored.zip
//  $ cp range-test.zip compressed.zip
//  $ cp range-test.zip encrypted.zip
//  $ cp range-test.zip encrypted-and-compressed.zip
//  $ rm -f zip-in-zip.zip
//  $ zip zip-in-zip.zip -0 stored.zip
//  $ zip zip-in-zip.zip -9 compressed.zip
//  $ zip zip-in-zip.zip -e0 encrypted.zip
//  $ zip zip-in-zip.zip -e9 encrypted-and-compressed.zip
var zipfileBuffer = hexToBuffer("" +
  "504b03040a000000000012978b4deb59385b00030000000300000a001c00" +
  "73746f7265642e7a69705554090003b34e105cb34e105c75780b000104f5" +
  "0100000414000000504b03040a00000000006a54954ab413389510000000" +
  "100000000a001c0073746f7265642e7478745554090003d842fa5842c5f7" +
  "5875780b000104e803000004e80300006161616261616162616161626161" +
  "6162504b03041400000008007554954ab413389508000000100000000e00" +
  "1c00636f6d707265737365642e7478745554090003ed42fa58ed42fa5875" +
  "780b000104e803000004e80300004b4c4c4c4a44c200504b03040a000900" +
  "00008454954ab41338951c000000100000000d001c00656e637279707465" +
  "642e74787455540900030743fa580743fa5875780b000104e803000004e8" +
  "030000f72e7bb915142131c934f01b163fcadb2a8db7cdafd0a6f4dd1694" +
  "c0504b0708b41338951c00000010000000504b03041400090008008a5495" +
  "4ab413389514000000100000001c001c00656e637279707465642d616e64" +
  "2d636f6d707265737365642e74787455540900031343fa581343fa587578" +
  "0b000104e803000004e80300007c4d3ea0d9754b470d3eb32ada5741bfc8" +
  "48f419504b0708b41338951400000010000000504b01021e030a00000000" +
  "006a54954ab413389510000000100000000a0018000000000000000000b4" +
  "810000000073746f7265642e7478745554050003d842fa5875780b000104" +
  "e803000004e8030000504b01021e031400000008007554954ab413389508" +
  "000000100000000e0018000000000001000000b48154000000636f6d7072" +
  "65737365642e7478745554050003ed42fa5875780b000104e803000004e8" +
  "030000504b01021e030a00090000008454954ab41338951c000000100000" +
  "000d0018000000000000000000b481a4000000656e637279707465642e74" +
  "787455540500030743fa5875780b000104e803000004e8030000504b0102" +
  "1e031400090008008a54954ab413389514000000100000001c0018000000" +
  "000001000000b48117010000656e637279707465642d616e642d636f6d70" +
  "7265737365642e74787455540500031343fa5875780b000104e803000004" +
  "e8030000504b0506000000000400040059010000910100000000504b0304" +
  "14000200080014978b4deb59385b43010000000300000e001c00636f6d70" +
  "7265737365642e7a69705554090003b84e105cb84e105c75780b000104f5" +
  "01000004140000000bf06666e1620081ac90a95e5b842da60a00d920ccc5" +
  "20c3505c925f949aa2575251121ac2c9c07cc3e95784d3d1ef11a515dc0c" +
  "8c2c2f981918c04462626212320e009a2902348183a1146a2607d44c3ea0" +
  "99c9f9b90545a9c5c548e6be059a0bc268e67afbf8f878b91c620800bb91" +
  "13a8bf056a9e0cd43c5ea079a979c94595052548c6b13bff8a006134e3be" +
  "eb55ef141551343c69f2415accfed46daddeed67d75f58f6e5aed8940301" +
  "deec1cc80643bcc009f44217d44a11a88c0cb295ba897929ba583c240cb4" +
  "5d18d30535be760b6e967abbf3da6dd6ba15eeb8ff84c7174998cd22709b" +
  "1999e49871458904030c6c690491c811c40a8920343b21e6e18a0e88798c" +
  "60f3428024ba5f58219183d54c5c5182ecc62540122d8258211184c399d8" +
  "831cd999e28c0c0422801512011836b0b2814c6101c248a0191341c63100" +
  "00504b03040a000900000017978b4deb59385b0c030000000300000d001c" +
  "00656e637279707465642e7a69705554090003bd4e105cbd4e105c75780b" +
  "000104f501000004140000009bd6cb7218424ef168da546c0b6d59f22eba" +
  "a151441ab2b05a585ef17c2ee42fc099edf13d92c4f8f3cb3c2d799da591" +
  "94833c301eb2ac61c24f5a6842185263ba5b8d2892653596b00545ef6448" +
  "2221f12b389676960c333f2592fb078fc9727c2b4d79c4594e3b3dcac077" +
  "df80f328fa71386a2b14b503040a38fba5d239ce35a51764b40ce97e26ef" +
  "ae346d06cd72623561c8dea8de4b7f4d8bea55348c1d7947762fe4650b97" +
  "ddd2cacd0709d4475e6090276953dc49d2fbfd9ab71449f2c9ad6ae3a0a9" +
  "98113d59a89b846cdc6bbad8f81f29969eeee1cee696ef144762eb160194" +
  "4dfce2652f880b5d4bcf1ddd233b1da5035a92cf0386bd2a3bbf84ca9624" +
  "658fa0eb9126004b5b680cf36e9a1ca4fa09340f70134314303d2e4f2de3" +
  "25f23e0923535a0098f061a34c49701e4d41e75a94a952cc0cdd36a1c18b" +
  "330806c9c989f64edd370e809c12532509afdc1c3e4aaf4348ba0e140a51" +
  "21b9133269b9c35c2bb2be9411783efed781ef5535f276d4a29c8e8c0fca" +
  "3c66d095395c838e8ba2605e27c2433a1512eba9aace53533be18a2af5ff" +
  "ae0ee24be4ebc69d005dc246d087c0e30886d9ea8902109883e0d08b0bde" +
  "bc078a38b8f39d52355de900f1c709aacb34489b8da567a62176cd8c5621" +
  "04e3308ce5c7d9d679b4deb6ca7afc2c3d925275045d5001854ea817cac3" +
  "3e3bd73c2976e59d1d5ba68ac678a89937818c4e097c1b1817a92448bc0b" +
  "d062b09a6c5f0ba1ae8e04207b792041ae68fa1e38004382042949e1166f" +
  "4dddc4cc0e8e448aceb31aad2d0381ad2e980bb79c708dc6a016af7b837f" +
  "60fc496dde93f0de43760ed4fa5d066ab9c867a07abfcdba6774e4ce52d0" +
  "fd0448a391f500b22f2891432edc9d753a3f41875bcb5a5ce3f7a1912875" +
  "5b9cdddc0e129a7d76a6d76817f90b34a75fb0b1e5f92adb56fca621a244" +
  "5ed01b83cea84af87e2c6d1e179cb4089c4e6a3eb281b9a49221e7ed051c" +
  "afc817e6c2c000dfba724f59d449b7e25dccf27d2996ed8cc755cb2b27ad" +
  "24b5d05318508bf73334d7a03c284ec53a0ec33cddac48b8d782e5a1dc8d" +
  "7804156773131c1e6d399e94504b0708eb59385b0c03000000030000504b" +
  "030414000b00080019978b4deb59385b4f010000000300001c001c00656e" +
  "637279707465642d616e642d636f6d707265737365642e7a697055540900" +
  "03c24e105cc24e105c75780b000104f50100000414000000d072220aeedb" +
  "1874034cc646e0e5189da11ce24fe0d997cad95397c0329b0bc0b553ead1" +
  "8ba928b901576f3525c17aa2b2111fe3330c1825f26813ed01ab8184afb4" +
  "7bceaf93d9a1493bd259e959cbc0487930865967ce3fc281a3d16099185c" +
  "ca0bd095fc101caa4efdffa6bafbe3fd54ea7e3056e46503ab4a3c2a6058" +
  "9b75aea345b673acc6410d33ef10c350b445f1c3bb8829aa5caf16d14dbb" +
  "d1d962fd89ab55305229c2f4c8da787fc72ac78d032c8dca61b843a693bc" +
  "8f92db86cfe78203dfe423bf2b5c7208284783b65ab4697fab0c5604888e" +
  "842fdb7752eaa9208605d26df46ffe1c284f9bf3399283500b13fecaf036" +
  "687bff034dc611056eb4244f8d15f210863f526fb8fcfc496cfedf5fb1b5" +
  "51344ff67bea02b4a3b2c9b862ced1ffe619b312b7c277fa1d4e3e64b553" +
  "b4b8e457f0a04199353d1a2564ef90da79fd089e0b56bfea2ca4256ba250" +
  "4b0708eb59385b4f01000000030000504b01021e030a000000000012978b" +
  "4deb59385b00030000000300000a0018000000000000000000a481000000" +
  "0073746f7265642e7a69705554050003b34e105c75780b000104f5010000" +
  "0414000000504b01021e0314000200080014978b4deb59385b4301000000" +
  "0300000e0018000000000000000000a48144030000636f6d707265737365" +
  "642e7a69705554050003b84e105c75780b000104f5010000041400000050" +
  "4b01021e030a000900000017978b4deb59385b0c030000000300000d0018" +
  "000000000000000000a481cf040000656e637279707465642e7a69705554" +
  "050003bd4e105c75780b000104f50100000414000000504b01021e031400" +
  "0b00080019978b4deb59385b4f010000000300001c001800000000000000" +
  "0000a48132080000656e637279707465642d616e642d636f6d7072657373" +
  "65642e7a69705554050003c24e105c75780b000104f50100000414000000" +
  "504b0506000000000400040059010000e70900000000" +
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
  util.inherits(StingyStoredEntryAsyncRandomAccessReader, yauzl.StoredEntryAsyncRandomAccessReader);
  function StingyStoredEntryAsyncRandomAccessReader(zipfile, entry) {
    yauzl.StoredEntryAsyncRandomAccessReader.call(this, zipfile, entry);
    this.upcomingByteCounts = [];
  }
  StingyStoredEntryAsyncRandomAccessReader.prototype._readStreamForRange = function(start, end, callback) {
    if (this.upcomingByteCounts.length > 0) {
      var expectedByteCount = this.upcomingByteCounts.shift();
      if (expectedByteCount != null) {
        if (expectedByteCount !== end - start) {
          throw new Error("expected " + expectedByteCount + " got " + (end - start) + " bytes");
        }
      }
    }
    return yauzl.StoredEntryAsyncRandomAccessReader.prototype._readStreamForRange.call(this, start, end, callback);
  };

  var options = {lazyEntries: true, autoClose: false};
  yauzl.fromBuffer(zipfileBuffer, options, function(err, outerZipfile) {
    var outerEntryIndex = 0;
    outerZipfile.readEntry();
    outerZipfile.on("entry", function(outerEntry) {
      // assert the structure of the outerZipfile is what we expect.  we use the same order of zip files
      // in the outer zip as we do with plain files in the inner zip so we can use the same functions to
      // check the state of either.
      if (outerEntry.isCompressed() !== shouldBeCompressed(outerEntryIndex)) throw new Error("assertion failure");
      if (outerEntry.isEncrypted()  !== shouldBeEncrypted(outerEntryIndex))  throw new Error("assertion failure");
      outerEntryIndex++;

      var testZipfile = function(zipfile) {
        var entries = [];
        zipfile.readEntry();
        zipfile.on("entry", function(entry) {
          var index = entries.length;
          // assert the structure of the zipfile is what we expect
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
                      var prefix = "zip-in-zip openReadStream with range(" + start + "," + end + "," + index + "): ";
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
          pend.wait(function() {
            outerZipfile.readEntry();
          });
        });
      };
      var zipfileReader = new StingyStoredEntryAsyncRandomAccessReader(outerZipfile, outerEntry);
      yauzl.fromRandomAccessReader(zipfileReader, outerEntry.uncompressedSize, options, function(err, zipfile) {
        if (err) {
          if (outerEntry.isCompressed()) {
            console.log('zip-in-zip fail on compressed zip entry reader: pass');
          } else if (outerEntry.isEncrypted()) {
            console.log('zip-in-zip fail on encrypted zip entry reader: pass');
          } else {
            console.log('zip-in-zip open stored zip entry reader: fail');
          }
          outerZipfile.readEntry();
        } else {
          testZipfile(zipfile);
        }
      });
    });
    outerZipfile.on("end", cb);
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
