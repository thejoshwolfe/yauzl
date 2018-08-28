// yauzl does not provide a Promise API,
// but yauzl's API follows the Node.js convention of
// using (err, result) callbacks as the final parameter.
// This lends itself cleanly to "promisifying" the API
// as shown in this example.
//
// This example requires V8 version 5.5+ (Node version 7.6+).
// While async/await is still experimental, you also need
// to run this example with --harmony-async-await

let yauzl = require("../"); // replace with: let yauzl = require("yauzl");

let simpleZipBuffer = new Buffer([
  80,75,3,4,20,0,8,8,0,0,134,96,146,74,0,0,
  0,0,0,0,0,0,0,0,0,0,5,0,0,0,97,46,116,120,
  116,104,101,108,108,111,10,80,75,7,8,32,
  48,58,54,6,0,0,0,6,0,0,0,80,75,1,2,63,3,
  20,0,8,8,0,0,134,96,146,74,32,48,58,54,6,
  0,0,0,6,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,180,
  129,0,0,0,0,97,46,116,120,116,80,75,5,6,0,
  0,0,0,1,0,1,0,51,0,0,0,57,0,0,0,0,0
]);

function promisify(api) {
  return function(...args) {
    return new Promise(function(resolve, reject) {
      api(...args, function(err, response) {
        if (err) return reject(err);
        resolve(response);
      });
    });
  };
}

let yauzlFromBuffer = promisify(yauzl.fromBuffer);

(async () => {
  let zipfile = await yauzlFromBuffer(simpleZipBuffer, {lazyEntries: true});
  console.log("number of entries:", zipfile.entryCount);
  let openReadStream = promisify(zipfile.openReadStream.bind(zipfile));
  zipfile.readEntry();
  zipfile.on("entry", async (entry) => {
    console.log("found entry:", entry.fileName);
    let stream = await openReadStream(entry);
    stream.on("end", () => {
      console.log("<EOF>");
      zipfile.readEntry();
    });
    stream.pipe(process.stdout);
  });
  zipfile.on("end", () => {
    console.log("end of entries");
  });
})();
