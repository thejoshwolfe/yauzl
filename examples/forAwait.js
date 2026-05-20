// This example demonstrates using for-await on the readStream you get from openReadStream().
// This caused a bug on node 26.1, so it doesn't really make sense to include in the examples/ directory,
// but I haven't moved it out of here yet.
var yauzl = require("../");
var fs = require("fs");
var path = require("path");

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error("give a path to a zipfile as an arg");

var done = false;

yauzl.open(paths[0], {lazyEntries: true}, function(err, zipfile) {
  if (err) throw err;
  zipfile.on("error", function(err) {
    throw err;
  });
  zipfile.once("close", function() {
    done = true;
  });
  zipfile.readEntry();
  zipfile.once("entry", function(entry) {
    zipfile.openReadStream(entry, function(err, readStream) {
      if (err) throw err;
      (async function() {
        var bytesSeen = 0;
        console.log("starting...");
        for await (let chunk of readStream) {
          if (bytesSeen === 0) console.log("  ...iterating");
          bytesSeen += chunk.length;
        }
        console.log("...closing after bytes:", bytesSeen);
        zipfile.close();
      })().catch(function(err) {
        throw err;
      });
    });
  });
});

process.on("exit", function(code) {
  if (code === 0 && !done) {
    throw new Error("premature exit. probably means an event never got fired.");
  }
});
