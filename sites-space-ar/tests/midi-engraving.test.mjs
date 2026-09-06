import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/xr.html", import.meta.url), "utf8");

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
