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
var fs = require("fs");

yauzl.open("path/to/file.zip", function(err, zipfile) {
  if (err) throw err;
  zipfile.on("entry", function(entry) {
    zipfile.openReadStream(entry, function(err, readStream) {
      if (err) throw err;
      readStream.pipe(fs.createWriteStream(entry.fileName));
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

This `callback` is the time to attach listeners for the `entry` event.

### Class: ZipFile

The constructor for the class is not part of the public API.
Use `open` or `fopen` instead.

#### Event: "entry"

Callback gets `(entry)`, which is an `Entry`.

#### Event: "end"

Emitted after the last `entry` event has been emitted.
Note that it is not necessarily safe to call `close` in response to this event.
There may still be open streams created by `openReadStream`.

#### openReadStream(entry, [callback])

`entry` must be an `Entry` object from this `ZipFile`.
`callback` gets `(err, readStream)`, where `readStream` is a `Readable Stream`.
If the entry is compressed (with a supported compression method),
the read stream provides the decompressed data.

#### close([callback])

Calls `fs.close(fd, callback)`.
This will probably cause problems if there are still open streams created by `openReadStream`.

#### entryCount

`Number`. Total number of central directory records.

#### comment

`Buffer`. TODO: decode with `cp473`.

### Class: Entry

Objects of this class represent Central Directory Records.
Refer to the zip file specification for their type and meaning.

These fields are of type `Number`:

 * `versionMadeBy`
 * `versionNeededToExtract`
 * `generalPurposeBitFlag`
 * `compressionMethod`
 * `lastModFileTime`
 * `lastModFileDate`
 * `crc32`
 * `compressedSize`
 * `uncompressedSize`
 * `fileNameLength`
 * `extraFieldLength`
 * `fileCommentLength`
 * `internalFileAttributes`
 * `externalFileAttributes`
 * `relativeOffsetOfLocalHeader`

#### fileName

`String`.
The bytes in the file are decoded with `utf8` if `generalPurposeBitFlag & 0x800`, as per the spec.
Otherwise, the file name is decoded with `ascii`, which is technically not correct.
The correct default encoding is `cp473`.

#### extraFields

`Array` with each entry in the form `{id: id, data: data}`,
where `id` is a `Number` and `data` is a `Buffer`.
None of the extra fields are considered significant by this library.

#### comment

`String` decoded with the same charset as used for `fileName`.

## Limitations

### Default Charset Should Be CP437

Currently, the default charset is `ascii`, but it should be `cp473`.

### No Multi-Disk Archive Support

This library does not support multi-disk zip files.
This API was intended for a zip file to span multiple floppy disks, which probably never happens now.
If the "number of this disk" field in the End of Central Directory Record is not `0`,
the `open` or `fopen` `callback` will receive an `err`.
By extension the following zip file fields are ignored by this library and not provided to clients:

 * Disk where central directory starts
 * Number of central directory records on this disk
 * Disk number where file starts

### No Encryption Support

Currently, the presence of encryption is not even checked,
and encrypted zip files will cause undefined behavior.

### Local File Headers Are Ignored

Many unzip libraries mistakenly read the Local File Header data in zip files.
This data is officially defined to be redundant with the Central Directory information,
and is not to be trusted.
There may be conflicts between the Central Directory information and the Local File Header,
but the Local File Header is always ignored.

### No CRC-32 Checking

This library provides the `crc32` field of `Entry` objects read from the Central Directory.
However, this field is not used for anything in this library.

### No Date/Time Conversion

The `lastModFileTime` and `lastModFileDate` fields of `Entry` objects
probably need to be interpreted according to the zip file spec to make them useful.
This library provides no support for this.

### versionNeededToExtract Is Ignored

The field `versionNeededToExtract` is ignored,
because this library doesn't support the complete zip file spec at any version,

### No Support For Obscure Compression Methods

Regarding the `compressionMethod` field of `Entry` objects,
only method `0` (stored with no compression)
and method `8` (deflated) are supported.
Any of the other 15 official methods will cause the `openReadStream` `callback` to receive an `err`.

### No ZIP64 Support

A ZIP64 file will probably cause undefined behavior.

### Data Descriptors Are Ignored

There may or may not be Data Descriptor sections in a zip file.
This library provides no support for finding or interpreting them.

### Archive Extra Data Record Is Ignored

There may or may not be an Archive Extra Data Record section in a zip file.
This library provides no support for finding or interpreting it.

### No Language Encoding Flag Support

Zip files officially support charset encodings other than CP437 and UTF-8,
but the zip file spec does not specify how it works.
This library makes no attempt to interpret the Language Encoding Flag.
