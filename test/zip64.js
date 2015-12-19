// see zip64/README.md

var fs = require("fs");
var path = require("path");
var yauzl = require("../");
var util = require("util");
var Readable = require("stream").Readable;
var Writable = require("stream").Writable;
var BufferList = require("bl");
var fd_slicer = require("fd-slicer");

function usage() {
  process.stdout.write("" +
    "zip64.js usage:\n" +
    "  (no arguments)        run the test\n" +
    "  -d dir/               dump the contents of the expected zip file into the specified directory\n" +
    "  -z in.zip out.zip     compress in.zip into out.zip\n" +
    "please see zip64/README.md\n" +
    "");
  process.exit(1);
}

function cli() {
  var arg1 = process.argv[2];
  var arg2 = process.argv[3];
  var arg3 = process.argv[4];

  if (arg1 == null) {
    runTest();
    return;
  }

  if (/^--?h/.test(arg1)) usage();

  if (arg1 === "-d") {
    if (arg2 == null) usage();
    dumpExpectedContents(arg2);
    return;
  }

  if (arg1 === "-z") {
    if (arg2 == null) usage();
    if (arg3 == null) usage();
    compressFile(arg2, arg3);
    return;
  }

  usage();
}

function dumpExpectedContents(outputDir) {
  var readStream = newLargeBinContentsProducer();
  readStream.pipe(fs.createWriteStream(path.join(outputDir, "large.bin")));
  readStream.on("progress", function(numerator, denominator) {
    process.stderr.write("\r" + numerator + "/" + denominator +
      "  " + ((numerator / denominator * 100) | 0) + "%");
    if (numerator === denominator) process.stderr.write("\n");
  });
  fs.writeFileSync(path.join(outputDir, "a.txt"), "hello a\n");
  fs.writeFileSync(path.join(outputDir, "b.txt"), "hello b\n");
}

var largeBinLength = 8000000000;
function newLargeBinContentsProducer() {
  // emits the fibonacci sequence:
  // 0, 1, 1, 2, 3, 5, 8, 13, ...
  // with each entry encoded in a UInt32BE.
  // arithmetic overflow will happen eventually, resulting in wrap around.
  // as a consequence of limited precision, this sequence repeats itself after 6442450944 entires.
  // however, we only require 2000000000 entires, so it's good enough.
  var readStream = new Readable();
  var prev0 = -1;
  var prev1 = 1;
  var byteCount = 0;
  readStream._read = function(size) {
    while (true) {
      if (byteCount >= largeBinLength) {
        readStream.push(null);
        return;
      }
      var bufferSize = Math.min(0x10000, largeBinLength - byteCount);
      var buffer = new Buffer(bufferSize);
      for (var i = 0; i < bufferSize; i += 4) {
        var n = ((prev0 + prev1) & 0xffffffff) >>> 0;
        prev0 = prev1;
        prev1 = n;
        byteCount += 4;
        buffer.writeUInt32BE(n, i, true);
      }
      readStream.emit("progress", byteCount, largeBinLength);
      if (!readStream.push(buffer)) return;
    }
  };
  readStream.isLargeBinContentsStream = true;
  return readStream;
}

function compressFile(inputPath, outputPath) {
  // this is just some bytes so we can go find it.
  var prefixLength = 0x100;

  getPrefixOfLargeBinContents(function(prefixBuffer) {
    findPrefixInPath(prefixBuffer, function(largeBinContentsOffset) {
      writeCompressedFile(largeBinContentsOffset);
    });
  });
  function getPrefixOfLargeBinContents(cb) {
    var prefixBuffer = new Buffer(prefixLength);
    var writer = new Writable();
    writer._write = function(chunk, encoding, callback) {
      chunk.copy(prefixBuffer, 0, 0, prefixLength);
      cb(prefixBuffer);
      // abandon this pipe
    };
    newLargeBinContentsProducer().pipe(writer);
  }
  function findPrefixInPath(prefixBuffer, cb) {
    var previewLength = 0x1000;
    fs.createReadStream(inputPath, {
      start: 0,
      end: previewLength + prefixLength - 1,
    }).pipe(BufferList(function(err, data) {
      if (err) throw err;
      for (var i = 0; i < previewLength; i++) {
        if (buffersEqual(data.slice(i, prefixLength), prefixBuffer)) {
          return cb(i);
        }
      }
      throw new Error("can't find large.bin contents");
    }));
  }
  function writeCompressedFile(largeBinContentsOffset) {
    var writeStream = fs.createWriteStream(outputPath);
    var headerBuffer = new Buffer(4);
    headerBuffer.writeUInt32BE(largeBinContentsOffset, 0);
    writeStream.write(headerBuffer);
    var firstReader = fs.createReadStream(inputPath, {
      start: 0,
      end: largeBinContentsOffset - 1,
    });
    firstReader.pipe(writeStream, {end: false});
    firstReader.on("end", function() {
      var secondReader = fs.createReadStream(inputPath, {
        start: largeBinContentsOffset + largeBinLength,
      });
      secondReader.pipe(writeStream);
    });
  }
}

function runTest() {
  makeRandomAccessReader(function(reader, size) {
    yauzl.fromRandomAccessReader(reader, size, function(err, zipfile) {
      if (err) throw err;
      var entryIndex = 0;
      zipfile.on("entry", function(entry) {
        var expectedContents;
        if (entryIndex === 0) {
          if (entry.fileName !== "a.txt") throw new Error("expected 'a.txt'. got '" + entry.fileName + "'.");
          expectedContents = "hello a\n";
        } else if (entryIndex === 1) {
          if (entry.fileName !== "large.bin") throw new Error("expected 'large.bin'. got '" + entry.fileName + "'.");
          expectedContents = null; // special case
        } else if (entryIndex === 2) {
          if (entry.fileName !== "b.txt") throw new Error("expected 'b.txt'. got '" + entry.fileName + "'.");
          expectedContents = "hello b\n";
        } else {
          throw new Error("too many entries");
        }
        entryIndex += 1;
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) throw err;
          if (expectedContents != null) {
            readStream.pipe(BufferList(function(err, data) {
              if (data.toString() !== expectedContents) throw new Error("expected contents:\n" + expectedContents + "\ngot:\n" + data.toString() + "\n");
              console.log("test/zip64: " + entry.fileName + ": PASS");
            }));
          } else {
            // make sure this is the big thing
            if (readStream.isLargeBinContentsStream) {
              console.log("test/zip64: " + entry.fileName + ": PASS");
            } else {
              throw new Error("large.bin contents read did not return expected stream")
            }
          }
        });
      });
    });
  });
}

function makeRandomAccessReader(cb) {
  fs.readFile(path.join(__dirname, "zip64/zip64.zip_fragment"), function(err, backendContents) {
    if (err) return callback(err);

    if (backendContents.length <= 4) throw new Error("unexpected EOF");
    var largeBinContentsOffset = backendContents.readUInt32BE(0);
    if (largeBinContentsOffset > backendContents.length) throw new Error(".zip_fragment header is malformed");
    var largeBinContentsEnd = largeBinContentsOffset + largeBinLength;

    var firstRead = true;
    var pretendSize = backendContents.length + largeBinLength - 4;

    util.inherits(InflatingRandomAccessReader, yauzl.RandomAccessReader);
    function InflatingRandomAccessReader() {
      yauzl.RandomAccessReader.call(this);
    }
    InflatingRandomAccessReader.prototype._readStreamForRange = function(start, end) {
      var thisIsTheFirstRead = firstRead;
      firstRead = false;
      var result = new BufferList();
      if (end <= largeBinContentsOffset) {
        result.append(backendContents.slice(start + 4, end + 4));
      } else if (start >= largeBinContentsOffset + largeBinLength) {
        result.append(backendContents.slice(start - largeBinLength + 4, end - largeBinLength + 4));
      } else if (start === largeBinContentsOffset && end === largeBinContentsEnd) {
        return newLargeBinContentsProducer();
      } else if (thisIsTheFirstRead && start > largeBinContentsOffset && end === pretendSize) {
        // yauzl's first move is to cast a large net to try to find the EOCDR.
        // yauzl's only going to care about the end of this data, so fill in the gaps with dummy data.
        var dummyTrash = new Buffer(largeBinContentsEnd - start);
        result.append(dummyTrash);
        result.append(backendContents.slice(largeBinContentsOffset + 4));
      } else {
        throw new Error("_readStreamForRange("+start+", "+end+") misaligned to range ["+largeBinContentsOffset+", "+largeBinContentsEnd+"]");
      }
      return result;
    };
    var reader = new InflatingRandomAccessReader();
    cb(reader, pretendSize);
  });
}

function buffersEqual(buf1, buf2) {
  for (var i = 0; i < buf1.length; i++) {
    if (buf1[i] !== buf2[i]) return false;
  }
  return true;
}

cli();
