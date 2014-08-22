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

#### entryCount

`Number`. Total number of central directory records.

#### comment

`Buffer`. TODO: decode with `cp473`.

### class Entry

Objects of this class represent Central Directory Records.
Refer to the zip file specification for their type and meaning.

These fields are numbers:

 * `versionMadeBy` : buffer.readUInt16LE(4);
 * `versionNeededToExtract` : buffer.readUInt16LE(6);
 * `generalPurposeBitFlag` : buffer.readUInt16LE(8);
 * `compressionMethod` : buffer.readUInt16LE(10);
 * `lastModFileTime` : buffer.readUInt16LE(12);
 * `lastModFileDate` : buffer.readUInt16LE(14);
 * `crc32` : buffer.readUInt32LE(16);
 * `compressedSize` : buffer.readUInt32LE(20);
 * `uncompressedSize` : buffer.readUInt32LE(24);
 * `fileNameLength` : buffer.readUInt16LE(28);
 * `extraFieldLength` : buffer.readUInt16LE(30);
 * `fileCommentLength` : buffer.readUInt16LE(32);
 * `internalFileAttributes` : buffer.readUInt16LE(36);
 * `externalFileAttributes` : buffer.readUInt32LE(38);
 * `relativeOffsetOfLocalHeader` : buffer.readUInt32LE(42);

#### fileName

`String`.
The bytes in the file are decoded with `utf8` if `generalPurposeBitFlag & 0x800`, as per the spec.
Otherwise, the file name is decoded with `ascii`, which is technically not correct.
The correct default encoding is `cp473`.

#### extraFields

`Array` with each entry in the form `{id: id, data: data}`, where `id` is a `Number` and `data` is a `Buffer`.
None of the extra fields are considered significant by this library.

#### comment

`String` decoded with the same charset as used for `fileName`.
