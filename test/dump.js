
var yauzl = require("../");

var paths = process.argv.slice(2);
paths.forEach(function(path) {
  yauzl.open(path, function(err, zipfile) {
    if (err) throw err;
    console.log("entries:", zipfile.entriesRemaining());
    keepReading();
    function keepReading() {
      if (zipfile.entriesRemaining() === 0) return;
      zipfile.readEntry(function(err, entry) {
        if (err) throw err;
        console.log(entry);
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) throw err;
          readStream.pipe(process.stdout);
        });
        keepReading();
      });
    }
  });
});

