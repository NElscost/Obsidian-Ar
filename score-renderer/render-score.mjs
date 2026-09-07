import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function decoded(value) { return typeof value === "string" ? JSON.parse(value) : value; }
async function optional(operation) {
  try { return decoded(await operation()); } catch { return null; }
}

const input = argument("--input");
const output = argument("--output");
if (!input || !output) throw new Error("Usage: render-score --input <score.mid> --output <cache-dir>");
await mkdir(output, { recursive: true });
function normalizeMidiToPiano(bytes) {
 const d=new Uint8Array(bytes),u=p=>((d[p]<<24)|(d[p+1]<<16)|(d[p+2]<<8)|d[p+3])>>>0,v=q=>{let x=0;for(let n=0;n<4&&q.p<q.e;n++){const b=d[q.p++];x=(x<<7)|(b&127);if(!(b&128))break;}return x;};
 if(String.fromCharCode(...d.slice(0,4))!=='MThd')return d;let o=8+u(4);
 while(o+8<=d.length&&String.fromCharCode(...d.slice(o,o+4))==='MTrk'){const l=u(o+4),q={p:o+8,e:Math.min(d.length,o+8+l)};let r=0;while(q.p<q.e){v(q);if(q.p>=q.e)break;let s=d[q.p];if(s&128){r=s;q.p++;}else s=r;if(!s)break;if(s===255){q.p++;q.p+=v(q);}else if(s===240||s===247)q.p+=v(q);else{const c=s&240,ch=s&15;if(c===192){if(ch!==9&&q.p<q.e)d[q.p]=0;q.p++;}else q.p+=c===208?1:2;}}o+=8+l;}return d;
}
const midi = normalizeMidiToPiano(await readFile(input));

// Compatibility with webmscore's older Emscripten Node shim on Node 18–24.
Object.defineProperty(globalThis, "navigator", {
  value: globalThis.navigator ?? {}, configurable: true, writable: true
});
Object.defineProperty(globalThis, "fetch", {
  value: undefined, configurable: true, writable: true
});
const { default: WebMscore } = await import("webmscore");
await WebMscore.ready;
const score = await WebMscore.load("midi", midi, [], true);

try {
  const pageCount = await score.npages();
  const pages = [];
  for (let page = 0; page < pageCount; page += 1) {
    const file = `page-${page}.svg`;
    await writeFile(join(output, file), await score.saveSvg(page, false));
    pages.push(file);
  }
  // Some imported MIDI files do not expose position maps in libmscore 3.
  // Keep these optional; playback/highlighting retains the lightweight MIDI timeline.
  const segmentPositions = await optional(() => score.segmentPositions());
  const measurePositions = segmentPositions ? await optional(() => score.measurePositions()) : null;
  const manifest = {
    version: 2, engine: "webmscore", instrument: "acoustic-grand-piano",
    title: basename(input).replace(/\.(?:mid|midi)$/i, ""),
    pageCount, pages, segmentPositions, measurePositions
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
  process.stdout.write(JSON.stringify(manifest));
} finally {
  score.destroy();
}
