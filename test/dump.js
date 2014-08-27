
var yauzl = require("../");

var paths = [];
var dumpContents = true;
process.argv.slice(2).forEach(function(arg) {
  if (arg === "--no-contents") {
    dumpContents = false;
  } else {
    paths.push(arg);
  }
});

paths.forEach(function(path) {
  yauzl.open(path, function(err, zipfile) {
    if (err) throw err;
    zipfile.on("error", function(err) {
      throw err;
    });
    zipfile.on("entry", function(entry) {
      console.log(entry);
      console.log(entry.getLastModDate());
      if (!dumpContents || /\/$/.exec(entry)) return;
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        readStream.pipe(process.stdout);
      });
    });
  });
});

