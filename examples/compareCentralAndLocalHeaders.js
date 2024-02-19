
var yauzl = require("../"); // replace with: var yauzl = require("yauzl");

function usage() {
  console.log(
    "usage: node compareCentralAndLocalHeaders.js path/to/file.zip\n" +
    "\n" +
    "Shows a table comparing the central directory metadata and local\n" +
    "file headers for each item in a zipfile.\n" +
    "");
  process.exit(1);
}

var zipfilePath = null;
var detailedExtraFieldBreakdown = true;
process.argv.slice(2).forEach(function(arg) {
  if (/^-/.test(arg)) usage();
  if (zipfilePath != null) usage();
  zipfilePath = arg;
});
if (zipfilePath == null) usage();

yauzl.open(zipfilePath, {lazyEntries: true, decodeStrings: false}, function(err, zipfile) {
  if (err) throw err;
  zipfile.on("error", function(err) {
    throw err;
  });
  zipfile.readEntry();
  zipfile.on("entry", function(entry) {
    zipfile.readLocalFileHeader(entry, function(err, localFileHeader) {
      if (err) throw err;
      compare(entry, localFileHeader);
      zipfile.readEntry();
    });
  });
})

function compare(entry, localFileHeader) {
  console.log(yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false));

  // Compare integers
  var integerFields = [
    "versionMadeBy",
    "versionNeededToExtract",
    "generalPurposeBitFlag",
    "compressionMethod",
    "lastModFileTime",
    "lastModFileDate",
    "crc32",
    "compressedSize",
    "uncompressedSize",
    "fileNameLength",
    "extraFieldLength",
    "fileCommentLength",
    "internalFileAttributes",
    "externalFileAttributes",
    "relativeOffsetOfLocalHeader",
  ];
  function formatNumber(numberOrNull) {
    if (numberOrNull == null) return "-";
    return "0x" + numberOrNull.toString(16);
  }

  var rows = [["field", "central", "local", "diff"]];
  rows.push(...integerFields.map(function(name) {
    var a = entry[name];
    var b = localFileHeader[name];
    var diff = a == null || b == null ? "" :
      a === b ? "" : "x";
    return [name, formatNumber(a), formatNumber(b), diff]
  }));

  var columnWidths = [0, 1, 2, 3].map(function(i) {
    return Math.max(...rows.map(row => row[i].length));
  });
  var formatFunctions = ["padEnd", "padStart", "padStart", "padEnd"];

  console.log("┌" + columnWidths.map(w => "─".repeat(w)).join("┬") + "┐");
  for (var i = 0; i < rows.length; i++) {
    console.log("│" + rows[i].map((x, j) => x[formatFunctions[j]](columnWidths[j])).join("│") + "│");
    if (i === 0) {
      console.log("├" + columnWidths.map(w => "─".repeat(w)).join("┼") + "┤");
    }
  }
  console.log("└" + columnWidths.map(w => "─".repeat(w)).join("┴") + "┘");

  // Compare variable length data.
  console.log("central.fileName:", entry.fileNameRaw.toString("hex"));
  if (entry.fileNameRaw.equals(localFileHeader.fileName)) {
    console.log("(local matches)");
  } else {
    console.log("  local.fileName:", localFileHeader.fileName.toString("hex"));
  }
  console.log("central.extraField:", entry.extraFieldRaw.toString("hex"));
  if (entry.extraFieldRaw.equals(localFileHeader.extraField)) {
    console.log("(local matches)");
  } else {
    console.log("  local.extraField:", localFileHeader.extraField.toString("hex"));
  }

  if (detailedExtraFieldBreakdown) {
    var centralExtraFieldMap = extraFieldsToMap(entry.extraFields);
    var localExtraFieldMap = extraFieldsToMap(yauzl.parseExtraFields(localFileHeader.extraField));
    for (var key in centralExtraFieldMap) {
      var centralData = centralExtraFieldMap[key];
      var localData = localExtraFieldMap[key];
      delete localExtraFieldMap[key]; // to isolate unhandled keys.
      console.log("    [" + key + "]central:", centralData.toString("hex"));
      if (localData != null && centralData.equals(localData)) {
        console.log("    [" + key + "](local matches)");
      } else if (localData != null) {
        console.log("    [" + key + "]  local:", localData.toString("hex"));
      } else {
        console.log("    [" + key + "]  local: <missing>");
      }
    }
    // Any keys left here don't match anything.
    for (var key in localExtraFieldMap) {
      var localData = localExtraFieldMap[key];
      console.log("    [" + key + "]central: <missing>");
      console.log("    [" + key + "]  local:", localData.toString("hex"));
    }
  }
  console.log("central.comment:", entry.fileCommentRaw.toString("hex"));

  console.log("");
}

function extraFieldsToMap(extraFields) {
  var map = {};
  extraFields.forEach(({id, data}) => {
    var key = "0x" + id.toString(16).padStart(4, "0");
    var baseKey = key;
    var i = 1;
    while (key in map) {
      key = baseKey + "." + i;
      i++;
    }
    map[key] = data;
  });
  return map;
}
