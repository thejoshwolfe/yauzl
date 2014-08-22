# yauzl

yet another unzip library for node.

Design principles:

 * Follow the spec.
   Don't scan for local file headers.
   Read the central directory for file metadata.
 * Don't block the JavaScript thread.
   Use and provide async apis.
 * Keep memory usage under control.
   Don't attempt to buffer entire files in RAM at once.

## Usage

```js
var yauzl = require("yauzl");
var fs = require('fs');

yauzl.open("path/to/file.zip", function(err, zipfile) {
  if (err) throw err;
  readNextEntry();
  function readNextEntry() {
    if (zipfile.entriesRemaining() === 0) return;
    zipfile.readEntry(function(err, entry) {
      if (err) throw err;
      console.log(entry);
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        readStream.pipe(fs.createWriteStream(entry.fileName));
      });
      readNextEntry();
    });
  }
});
```

## API

### open(path, callback)

Calls `fs.open(path, "r")` and gives the `fd` and `callback` to `fopen` below.

### fopen(fd, callback)

Reads from the fd, which is presumed to be an open .zip file.
Note that random access is required by the zip file specification,
so the fd cannot be an open socket or any other fd that does not support random access.

The `callback` is given the arguments `(err, zipfile)`.
An `err` is provided if the End of Central Directory Record Signature cannot be found in the file,
which indicates that the fd is not a zip file.
If `err` is `null`, `zipfile` is an instance of `ZipFile`.

### class ZipFile

The constructor for the class is not part of the public API.
Use `open` or `fopen` instead.

TODO: continue documentation...
