import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleUrl = new URL("../public/vendor/audio/spectral-trail-ar.js", import.meta.url);

test("renders a transparent spectral window with an optional bounded network", async () => {
  const source = await readFile(moduleUrl, "utf8");
  assert.doesNotMatch(source, /opacity:\s*0\.72/);
  assert.match(source, /new THREE\.LineSegments/);
  assert.match(source, /const segmentCount = LAYERS \* NETWORK_PEAKS \* 2/);
  assert.match(source, /state\.mode = \(state\.mode \+ 1\) % 3/);
  assert.match(source, /\["points", "network", "points \+ network"\]/);
  assert.doesNotMatch(source, /outlineGeometry|new THREE\.LineBasicMaterial/);
  assert.match(source, /const NETWORK_PEAKS = 14/);
  assert.match(source, /const localPeaks = \[\]/);
  assert.match(source, /state\.previousPeaks/);
});
