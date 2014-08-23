
var yauzl = require("../");

var paths = process.argv.slice(2);
paths.forEach(function(path) {
  yauzl.open(path, function(err, zipfile) {
    if (err) throw err;
    zipfile.on("error", function(err) {
      throw err;
    });
    zipfile.on("entry", function(entry) {
      console.log(entry);
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        readStream.pipe(process.stdout);
      });
    });
  });
});

