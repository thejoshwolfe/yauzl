// this is a diagnostic tool independent of the yauzl library.
// this too is useful for examining the details of how a zipfile is put together.

var fs = require("fs");

var zipfileBuffer;
function main() {
  var args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("exactly 1 arg expected, which is a zip file");

  zipfileBuffer = fs.readFileSync(args[0]);
  reports.push({offset:zipfileBuffer.length});
  readEocdr();

  printEverything();
}

function readEocdr() {
  // search backwards for the eocdr
  for (var eocdrOffset = zipfileBuffer.length - 22; eocdrOffset >= Math.max(0, zipfileBuffer.length - 22 - 0x10000); eocdrOffset--) {
    if (zipfileBuffer.readUInt32LE(eocdrOffset) !== 0x06054b50) continue;
    // found the eocdr
    var expectedCommentLength = zipfileBuffer.length - eocdrOffset - 22;
    reportStruct(eocdrOffset, "End of Central Directory Record", 0, [
      [4, "End of central directory signature", {signature:0x06054b50}],
      [2, "Number of this disk"],
      [2, "Disk where central directory starts"],
      [2, "Number of central directory records on this disk"],
      [2, "Total number of central directory records"],
      [4, "Size of central directory (bytes)"],
      [4, "Offset of start of central directory, relative to start of archive"],
      [2, "Comment Length"],
    ]);
    var entryCount = zipfileBuffer.readUInt16LE(eocdrOffset + 10);
    var centralDirectoryOffset = zipfileBuffer.readUInt32LE(eocdrOffset + 16);
    var commentLength = zipfileBuffer.readUInt16LE(eocdrOffset + 20);
    // the encoding is always cp437.
    reportBlob(eocdrOffset + 22, "Zip File Comment", 1, commentLength, false);

    if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
      // ZIP64 format
      var zip64EocdlOffset = eocdrOffset - 20;
      reportStruct(zip64EocdlOffset, "ZIP64 End of Central Directory Locator", 0, [
        [4, "zip64 end of central dir locator signature", {signature:0x07064b50}],
        [4, "number of the disk with the start of the zip64 end of central directory"],
        [8, "relative offset of the zip64 end of central directory record"],
        [4, "total number of disks"],
      ]);

      var zip64EocdrOffset = readUInt64LE(zipfileBuffer, zip64EocdlOffset + 8);
      reportStruct(zip64EocdrOffset, "ZIP64 End of Central Directory Record", 0, [
        [4, "zip64 end of centrawl dir signature", {signature:0x06064b50}],
        [8, "size of zip64 end of central directory record"],
        [2, "version made by"],
        [2, "version needed to extract"],
        [4, "number of this disk"],
        [4, "number of the disk with the start of the central directory"],
        [8, "total number of entries in the central directory on this disk"],
        [8, "total number of entries in the central directory"],
        [8, "size of the central directory"],
        [8, "offset of start of central directory with respect to the starting disk number"],
      ]);
      entryCount = readUInt64LE(zipfileBuffer, zip64EocdrOffset + 32);
      centralDirectoryOffset = readUInt64LE(zipfileBuffer, zip64EocdrOffset + 48);

      // this always seems to be empty
      var zip64ExensibleDataSectorOffset = zip64EocdrOffset + 56;
      var zip64ExensibleDataSectorLength = readUInt64LE(zipfileBuffer, zip64EocdrOffset + 4) - 56 + 12;
      reportBlob(zip64ExensibleDataSectorOffset, "ZIP64 Extensible Data Sector", 1, zip64ExensibleDataSectorLength);
    }

    var cursor = centralDirectoryOffset;
    for (var i = 0; i < entryCount; i++) {
      cursor = readCentralDirectoryRecord(cursor);
    }
    return;
  }
  throw new Error("end of central directory record not found. is this even a zip file?");
}
function readCentralDirectoryRecord(offset) {
  reportStruct(offset, "Central Directory Record", 0, [
    [4, "Central directory file header signature", {signature:0x02014b50}],
    [2, "Version made by"],
    [2, "Version needed to extract (minimum)"],
    [2, "General purpose bit flag"],
    [2, "Compression method"],
    [2, "File last modification time"],
    [2, "File last modification date"],
    [4, "CRC-32"],
    [4, "Compressed size"],
    [4, "Uncompressed size"],
    [2, "File name length (n)"],
    [2, "Extra field length (m)"],
    [2, "File comment length (k)"],
    [2, "Disk number where file starts"],
    [2, "Internal file attributes"],
    [4, "External file attributes"],
    [4, "Relative offset of local file header"],
  ]);
  var generalPurposeBitFlag = zipfileBuffer.readUInt16LE(offset + 8);
  var fileNameLength = zipfileBuffer.readUInt16LE(offset + 28);
  var extraFieldLength = zipfileBuffer.readUInt16LE(offset + 30);
  var fileCommentLength = zipfileBuffer.readUInt16LE(offset + 32);

  var isUtf8 = (generalPurposeBitFlag & 0x800) !== 0;
  var cursor = offset + 46;
  reportBlob(cursor, "File Name", 1, fileNameLength, isUtf8);
  cursor += fileNameLength;

  var zip64EiefOverridables = {
    isZip64: false,
    compressedSize: zipfileBuffer.readUInt32LE(offset + 20),
    uncompressedSize: zipfileBuffer.readUInt32LE(offset + 24),
    diskStartNumber: zipfileBuffer.readUInt16LE(offset + 34),
    relativeOffsetOfLocalHeader: zipfileBuffer.readUInt32LE(offset + 42),
  };
  readExtraFields(cursor, extraFieldLength, zip64EiefOverridables);
  cursor += extraFieldLength;

  reportBlob(cursor, "File Comment", 1, fileCommentLength, false);
  cursor += fileCommentLength;

  // also process everything about this entry
  readLocalFileHeader(zip64EiefOverridables.relativeOffsetOfLocalHeader,
                      zip64EiefOverridables.compressedSize,
                      zip64EiefOverridables.isZip64);

  return cursor;
}
function readLocalFileHeader(offset, compressedSize, isZip64) {
  reportStruct(offset, "Local File Header", 0, [
    [4, "Local file header signature", {signature:0x04034b50}],
    [2, "Version needed to extract (minimum)"],
    [2, "General purpose bit flag"],
    [2, "Compression method"],
    [2, "File last modification time"],
    [2, "File last modification date"],
    [4, "CRC-32"],
    [4, "Compressed size"],
    [4, "Uncompressed size"],
    [2, "File name length (n)"],
    [2, "Extra field length (m)"],
  ]);
  var generalPurposeBitFlag = zipfileBuffer.readUInt16LE(offset + 6);
  var fileNameLength = zipfileBuffer.readUInt16LE(offset + 26);
  var extraFieldLength = zipfileBuffer.readUInt16LE(offset + 28);

  var isUtf8 = (generalPurposeBitFlag & 0x800) !== 0;
  var cursor = offset + 30;
  reportBlob(cursor, "File Name", 1, fileNameLength, isUtf8);
  cursor += fileNameLength;

  readExtraFields(cursor, extraFieldLength, null);
  cursor += extraFieldLength;

  // report entire file contents
  reportBlob(cursor, "File Data", 0, compressedSize, false);
  cursor += compressedSize;

  var useDataDescriptor = (generalPurposeBitFlag & 0x8) !== 0;
  if (useDataDescriptor) {
    // the structure of the Data Descriptor is complicated
    var structDefinition = [];
    if (zipfileBuffer.readUInt32LE(cursor) === 0x08074b50) {
      // there's a signature
      structDefinition.push([4, "optional signature", {signature:0x08074b50}]);
    }
    structDefinition.push([4, "crc-32"]);
    if (isZip64) {
      structDefinition.push([8, "compressed size"]);
      structDefinition.push([8, "uncompressed size"]);
    } else {
      structDefinition.push([4, "compressed size"]);
      structDefinition.push([4, "uncompressed size"]);
    }
    reportStruct(cursor, "Data Descriptor", 1, structDefinition);
  }
}
function readExtraFields(offset, extraFieldLength, zip64EiefOverridables) {
  var cursor = offset;
  while (cursor < offset + extraFieldLength - 3) {
    var headerId = zipfileBuffer.readUInt16LE(cursor + 0);
    var dataSize = zipfileBuffer.readUInt16LE(cursor + 2);
    var dataStart = cursor + 4;
    var dataEnd = dataStart + dataSize;
    if (dataEnd > offset + extraFieldLength) {
      warning(cursor + 2, "Extra field size exceeds extra fields bounds. truncating.");
      dataEnd = offset + extraFieldLength;
      dataSize = dataEnd - dataStart;
    }
    var extraFieldsDescription = null;
    if (cursor === offset) {
      // we only need to report this once
      extraFieldsDescription = "Extra Fields";
    }
    var sectionDescription = "Header Id";

    var reported = false;
    if (headerId === 0x7075) {
      sectionDescription += " (Info-ZIP Unicode Path Extra Field)";
      reportStruct(dataStart, null, 2, [
        [1, "Version"],
        [4, "Name CRC32"],
      ]);
      reportBlob(dataStart + 5, null, 2, dataSize - 5, true);
      reported = true;
    } else if (headerId === 0x0001 & zip64EiefOverridables != null) {
      sectionDescription += " (Zip64 Extended Information Extra Field)";
      var structDefinition = [];
      zip64EiefOverridables.isZip64 =
          zip64EiefOverridables.ncompressedSize            === 0xffffffff ||
          zip64EiefOverridables.ompressedSize              === 0xffffffff ||
          zip64EiefOverridables.elativeOffsetOfLocalHeader === 0xffffffff ||
          zip64EiefOverridables.iskStartNumber             === 0xffff;
      var index = 0;
      do { // while false, just to get break that acts like goto
        if (zip64EiefOverridables.uncompressedSize === 0xffffffff) {
          if (index + 8 > dataSize) {
            warning(dataStart + index, "Zip64 Extended Information Extra Field does not include Original Size");
            break;
          }
          zip64EiefOverridables.uncompressedSize = readUInt64LE(zipfileBuffer, dataStart + index);
          index += 8;
          structDefinition.push([8, "Original Size"]); // aka uncompressed size
        }
        if (zip64EiefOverridables.compressedSize === 0xffffffff) {
          if (index + 8 > dataSize) {
            warning(dataStart + index, "Zip64 Extended Information Extra Field does not include Compressed Size");
            break;
          }
          zip64EiefOverridables.compressedSize = readUInt64LE(zipfileBuffer, dataStart + index);
          index += 8;
          structDefinition.push([8, "Compressed Size"]);
        }
        if (zip64EiefOverridables.relativeOffsetOfLocalHeader === 0xffffffff) {
          if (index + 8 > dataSize) {
            warning(dataStart + index, "Zip64 Extended Information Extra Field does not include Relative Header Offset");
            break;
          }
          zip64EiefOverridables.relativeOffsetOfLocalHeader = readUInt64LE(zipfileBuffer, dataStart + index);
          index += 8;
          structDefinition.push([8, "Relative Header Offset"]);
        }
        if (zip64EiefOverridables.diskStartNumber === 0xffff) {
          if (index + 4 > dataSize) {
            warning(dataStart + index, "Zip64 Extended Information Extra Field does not include Disk Start Number");
            break;
          }
          zip64EiefOverridables.diskStartNumber = readUInt64LE(zipfileBuffer, dataStart + index);
          index += 4;
          structDefinition.push([4, "Disk Start Number"]);
        }

        reportStruct(dataStart, null, 2, structDefinition);
        reported = true;
      } while (false);
    }
    if (!reported) {
      // unrecognized
      reportBlob(dataStart, null, 2, dataSize, false);
    }

    // finally report the header back where it was supposed to be,
    // now that we have more information on its description
    reportStruct(cursor, extraFieldsDescription, 1, [
      [2, sectionDescription],
      [2, "Data Size"],
    ]);

    cursor = dataEnd;
  }
}

var reports = [];
function formatOffset(offset) {
  return "0x" + zfill(offset.toString(16), zipfileBuffer.length.toString(16).length);
}
function formatHexLE(offset, len) {
  var string = "0x";
  for (var i = 0; i < len; i++) {
    // byte swap
    var b = zipfileBuffer[offset + len - i - 1];
    if (b < 16) string += "0";
    string += b.toString(16);
  }
  return string;
}
function formatBlob(offset, len, wrap, isUtf8) {
  var wrapWidth = wrap ? 16 : len;
  var rows = [];
  for (var i = 0; i < len;) {
    var wrapStart = i;
    var wrapBreak = Math.min(i + wrapWidth, len);
    var string = "";
    for (; i < wrapBreak; i++) {
      var b = zipfileBuffer[offset + i];
      if (b < 16) string += "0";
      string += b.toString(16);
      if (i < wrapBreak - 1) string += " ";
    }
    rows.push([string, "; " + formatString(offset + wrapStart, offset + wrapBreak, isUtf8)]);
  }
  return wrap ? rows : rows[0];
}
function formatString(start, end, isUtf8) {
  var string = bufferToString(zipfileBuffer, start, end, isUtf8);
  string = string.replace(/\\/g, "\\\\");
  string = string.replace(/"/g, "\\\"");
  if (isUtf8) {
    string = string.replace(/\n/g, "\\n");
    string = string.replace(/\r/g, "\\r");
    string = string.replace(/\t/g, "\\t");
    string = string.replace(/[\u0000-\u001f]/g, function(c) { return "\\u" + zfill(c.charCodeAt(0).toString(16), 4); });
    // there's probably a lot more to escape if we cared.
  }
  return "\"" + string + "\"";
}
function reportBlob(offset, description, indentation, len, isUtf8) {
  if (len === 0) return;
  var rows = formatBlob(offset, len, true, isUtf8);
  reports.push({offset:offset, len:len, description:description, rows:rows, indentation:indentation});
}
function reportStruct(offset, description, indentation, structDefinition) {
  var rows = [];
  var cursor = 0;
  for (var i = 0; i < structDefinition.length; i++) {
    var fieldSize = structDefinition[i][0];
    var fieldName = structDefinition[i][1];
    var options   = structDefinition[i][2] || {};
    // includes string representation
    var row = formatBlob(offset + cursor, fieldSize, false, false);
    var value;
    if (fieldSize === 1) {
      value = zipfileBuffer.readUInt8(offset + cursor);
    } else if (fieldSize === 2) {
      value = zipfileBuffer.readUInt16LE(offset + cursor);
    } else if (fieldSize === 4) {
      value = zipfileBuffer.readUInt32LE(offset + cursor);
    } else if (fieldSize === 8) {
      value = readUInt64LE(zipfileBuffer, offset + cursor);
    } else throw new Error("bad fieldSize");
    if (options.signature != null && value !== options.signature) {
      warning(offset + cursor, "signature mismatch. expected 0x" + options.signature.toString(16) + ", got 0x" + value.toString(16));
    }
    if (value < Number.MAX_SAFE_INTEGER) {
      // base 10
      row.push("= " + value.toString());
    }
    // hex
    row.push("= " + formatHexLE(offset + cursor, fieldSize));
    row.push("; " + fieldName);
    rows.push(row);

    cursor += fieldSize;
  }
  reports.push({offset:offset, len:cursor, description:description, rows:rows, indentation:indentation});
}

function warning(offset, msg) {
  reports.push({offset:offset, warning:msg});
}
function printEverything() {

  // first find gaps and overlaps
  reports.sort(function(a, b) { return a.offset - b.offset; });
  var cursor = 0;
  for (var i = 0; i < reports.length; i++) {
    var report = reports[i];
    var offset = report.offset;
    if (report.len == null) continue;
    if (cursor < offset) {
      // gap
      reportBlob(cursor, "(unused data)", 0, offset - cursor, false);
      cursor = offset;
    } else if (cursor > offset) {
      // overlap
      warning(offset, "overlapping " + (cursor - offset) + " bytes of data used for multiple interpretations");
      firstLine = false;
      cursor = offset;
    }

    cursor += report.len;
  }

  // now process the data proper
  reports.sort(function(a, b) { return a.offset - b.offset; });
  cursor = 0;
  var firstLine = true;
  reports.forEach(function(report) {
    var offset = report.offset;
    if (offset === zipfileBuffer.length) return;

    if (report.len == null) {
      if (report.warning != null) {
        console.log("; WARNING(" + formatOffset(report.offset) + "): " + report.warning);
        return;
      }
      throw new Error("what kind of report is this: " + JSON.stringif(report));
    }

    var indentation = ljust("", report.indentation * 2);
    if (report.description != null) {
      if (!firstLine) console.log("");
      console.log(indentation + ":" + formatOffset(offset) + " ; " + report.description);
    }
    firstLine = false;

    var columnWidths = report.rows[0].map(function() { return 0; });
    report.rows.forEach(function(row) {
      row.forEach(function(cell, i) {
        if (cell.length > columnWidths[i]) {
          columnWidths[i] = cell.length;
        }
      });
    });
    columnWidths[columnWidths.length - 1] = 0; // don't actually need to alight the last column

    console.log(report.rows.map(function(row) {
      return indentation + row.map(function(cell, i) {
        return ljust(cell, columnWidths[i]);
      }).join(" ");
    }).join("\n"));

    cursor += report.len;
  });
}

// the null byte was replaced with � so that none of the cp437 characters would have 0 width.
var cp437 = '�☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function bufferToString(buffer, start, end, isUtf8) {
  if (isUtf8) {
    return buffer.toString("utf8", start, end);
  } else {
    var result = "";
    for (var i = start; i < end; i++) {
      result += cp437[buffer[i]];
    }
    return result;
  }
}
function zfill(string, len) {
  while (string.length < len) string = "0" + string;
  return string;
}
function ljust(string, len) {
  while (string.length < len) string += " ";
  return string;
}
function readUInt64LE(buffer, offset) {
  var lower32 = buffer.readUInt32LE(offset);
  var upper32 = buffer.readUInt32LE(offset + 4);
  // we can't use bitshifting here, because JavaScript bitshifting only works on 32-bit integers.
  return upper32 * 0x100000000 + lower32;
}


main();
