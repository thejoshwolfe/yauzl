const yauzl = require("../"); // replace with: const yauzl = require("yauzl");

// Parse CLI args.
const paths = [];
let dumpContents = true;
let shouldReadStream = true;
process.argv.slice(2).forEach(function(arg) {
  if (arg === "--no-contents") {
    dumpContents = false;
  } else if (arg === "--no-readStream") {
    shouldReadStream = false;
  } else {
    paths.push(arg);
  }
});

// Read each arg .zip and dump its contents to stdout.
(async () => {
  for (let path of paths) {
    try {
      const zipfile = await yauzl.openPromise(path);
      for await (let entry of zipfile.eachEntry()) {
        console.log(entry);
        if (!shouldReadStream || entry.fileName.endsWith("/")) continue;

        const readStream = await zipfile.openReadStreamPromise(entry);
        // You should just use readStream.pipe(process.stdout) if you don't care about individual chunks.
        // This example demonstrates detailed involvement in the piping process.
        let chunksSeen = 0;
        for await (let chunk of readStream) {
          console.log("seeing chunk:", chunksSeen);
          chunksSeen++;
          if (chunksSeen === 10) {
            console.log("interrupting the read stream");
            readStream.destroy();
            break;
          }
          if (dumpContents) {
            await writeToStream(process.stdout, chunk);
          }
        }
        console.log(`readStream completed in ${chunksSeen} chunks`);
      }
    } catch (err) {
      // yauzl errors get thrown by `await` expressions and end up here.
      throw err;
    }
  }
})();

function writeToStream(stream, chunk) {
  // As of 2023, you have to write this function in your own code.
  // https://github.com/nodejs/node/issues/49658
  return new Promise(resolve => {
    if (!stream.write(chunk)) {
      stream.once('drain', resolve);
    } else {
      resolve();
    }
  });
}
