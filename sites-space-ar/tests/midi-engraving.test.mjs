import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/xr.html", import.meta.url), "utf8");
const renderer = await readFile(new URL("../../score-renderer/render-score.mjs", import.meta.url), "utf8");
const bridge = await readFile(new URL("../../note-bridge-rs/src/main.rs", import.meta.url), "utf8");

test("loads optional engraved score pages without replacing the MIDI fallback", () => {
  assert.match(html, /prepareMidiVizEngraving/);
  assert.match(html, /\/midi-score/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /function drawMidiVizScore/);
});

test("keeps the playback overlay separate from the engraved page texture", () => {
  assert.match(html, /midiVizScorePlayhead/);
  assert.match(html, /midiVizScoreHighlight/);
  assert.match(html, /midiVizEngravedManifest/);
});


test("filters imported tracks into one acoustic piano score", () => {
  assert.match(renderer, /normalizeMidiToPiano/);
  assert.match(renderer, /tracks: "piano-only"/);
  assert.match(renderer, /instrument: "acoustic-grand-piano"/);
  assert.match(html, /midiVizEngravedPosition/);
  assert.match(html, /RingGeometry\(\.009, \.015/);
  assert.match(html, /systemProgress=\(within\*2\)%1/);
  assert.match(bridge, /write_score_system_pages/);
  assert.match(bridge, /systems\.chunks\(2\)/);
});
