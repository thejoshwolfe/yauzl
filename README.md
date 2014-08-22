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
  zipfile.readEntries(function(err, entries) {
    if (err) throw err;
    entries.forEach(function(entry) {
      zipfile.openReadStream(entry, function(err, readStream) {
        if (err) throw err;
        readStream.pipe(fs.createWriteStream(entry.fileName));
      });
    });
  });
});
```

## API

The default for every `callback` parameter is:

```js
function defaultCallback(err) {
  if (err) throw err;
}
```

### open(path, [callback])

Calls `fs.open(path, "r")` and gives the `fd` and `callback` to `fopen` below.

### fopen(fd, [callback])

Reads from the fd, which is presumed to be an open .zip file.
Note that random access is required by the zip file specification,
so the fd cannot be an open socket or any other fd that does not support random access.

The `callback` is given the arguments `(err, zipfile)`.
An `err` is provided if the End of Central Directory Record Signature cannot be found in the file,
which indicates that the fd is not a zip file.
`zipfile` is an instance of `ZipFile`.

### class ZipFile

The constructor for the class is not part of the public API.
Use `open` or `fopen` instead.

#### close([callback])

Calls `fs.close(fd, callback)`.

#### readEntries([callback])

`callback` gets `(err, entries)`, where `entries` is an `Array` of `Entry` objects.

#### openReadStream(entry, [callback])

`entry` must be an `Entry` object from this `ZipFile`.
`callback` gets `(err, readStream)`, where `readStream` is a `Readable Stream`.
If the entry is compressed (with a supported compression method),
the read stream provides the decompressed data.

#### entriesRemaining()

Returns the number of entries in this `ZipFile` that have not yet been returned by `readEntry`.

#### readEntry([callback])

Most clients should use the `readEntries` function.
`readEntry` and `entriesRemaining` provide low-level access for reading one entry at a time.
This can be useful if the index were very large, and you wanted to start reading entries right away.

Calling this function directly sabotages the `readEntries` function.
You must not call this function before any previous call to this function completes by calling its `callback`.

TODO: really? This API is super sketchy.

### class Entry

TODO: document (and make this an actual class or whatever).
