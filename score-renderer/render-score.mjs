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
  const source=new Uint8Array(bytes),u32=p=>((source[p]<<24)|(source[p+1]<<16)|(source[p+2]<<8)|source[p+3])>>>0;
  const vlq=q=>{let value=0;for(let count=0;count<4&&q.pos<q.end;count++){const byte=source[q.pos++];value=(value<<7)|(byte&127);if(!(byte&128))break;}return value;};
  const encodeVlq=value=>{const out=[value&127];while((value>>>=7)>0)out.unshift((value&127)|128);return out;};
  if(String.fromCharCode(...source.slice(0,4))!=='MThd'||source.length<14)return source;
  const division=[source[12],source[13]],tempoEvents=[],tracks=[];let offset=8+u32(4),order=0,trackIndex=0;
  while(offset+8<=source.length&&String.fromCharCode(...source.slice(offset,offset+4))==='MTrk'){
    const length=u32(offset+4),q={pos:offset+8,end:Math.min(source.length,offset+8+length)},programs=new Uint8Array(16),programSeen=new Uint8Array(16),events=[],labels=[];let tick=0,running=0;
    while(q.pos<q.end){tick+=vlq(q);if(q.pos>=q.end)break;let status=source[q.pos];if(status&128){running=status;q.pos++;}else status=running;if(!status)break;
      if(status===255){const type=source[q.pos++],size=vlq(q),payload=[...source.slice(q.pos,Math.min(q.end,q.pos+size))];q.pos+=size;
        if([3,4].includes(type))labels.push(String.fromCharCode(...payload).toLowerCase());
        if([81,88,89].includes(type))tempoEvents.push({tick,order:order++,priority:0,data:[255,type,...encodeVlq(payload.length),...payload]});
      }else if(status===240||status===247){q.pos+=vlq(q);}
      else{const cmd=status&240,channel=status&15,size=(cmd===192||cmd===208)?1:2,data=[...source.slice(q.pos,Math.min(q.end,q.pos+size))];q.pos+=size;
        if(cmd===192&&data.length){programs[channel]=data[0];programSeen[channel]=1;}
        if((cmd===128||cmd===144)&&data.length===2&&channel!==9)events.push({tick,order:order++,priority:cmd===128||data[1]===0?1:2,channel,program:programs[channel],programSeen:Boolean(programSeen[channel]),data:[cmd,data[0],data[1]]});
      }
    }
    tracks.push({index:trackIndex++,labels:labels.join(' '),events});
    offset+=8+length;
  }
  const pianoName=/\b(?:piano|grand|keyboard|keys|acoustic)\b/i;
  let selected=tracks.filter(track=>pianoName.test(track.labels)||track.events.some(event=>event.programSeen&&event.program<=7));
  if(!selected.length){const candidates=tracks.filter(track=>track.events.length).sort((a,b)=>b.events.length-a.events.length);if(candidates.length)selected=[candidates[0]];}
  const selectedIds=new Set(selected.map(track=>track.index)),events=[...tempoEvents];
  for(const track of tracks){if(!selectedIds.has(track.index))continue;const namedPiano=pianoName.test(track.labels);for(const event of track.events){if(namedPiano||!event.programSeen||event.program<=7)events.push(event);}}
  events.sort((x,y)=>x.tick-y.tick||x.priority-y.priority||x.order-y.order);const outputTrack=[0,192,0];let previous=0;
  for(const event of events){outputTrack.push(...encodeVlq(Math.max(0,event.tick-previous)),...event.data);previous=event.tick;}outputTrack.push(0,255,47,0);
  const output=[77,84,104,100,0,0,0,6,0,0,0,1,...division,77,84,114,107,(outputTrack.length>>>24)&255,(outputTrack.length>>>16)&255,(outputTrack.length>>>8)&255,outputTrack.length&255,...outputTrack];
  return { bytes:new Uint8Array(output), sourceTrackCount:tracks.length, selectedTrackCount:selected.length };
}
const normalized = normalizeMidiToPiano(await readFile(input));
const midi = normalized.bytes ?? normalized;

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
    version: 4, engine: "webmscore", instrument: "acoustic-grand-piano", tracks: "piano-only", sourceTrackCount: normalized.sourceTrackCount ?? 1, selectedTrackCount: normalized.selectedTrackCount ?? 1,
    title: basename(input).replace(/\.(?:mid|midi)$/i, ""),
    pageCount, pages, segmentPositions, measurePositions
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
  process.stdout.write(JSON.stringify(manifest));
} finally {
  score.destroy();
}
