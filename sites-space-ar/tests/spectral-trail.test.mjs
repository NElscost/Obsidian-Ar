import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/", import.meta.url);

test("integrates an anchored, scalable spectral trail with the media analyser", async () => {
  const [html, spectral] = await Promise.all([
    readFile(new URL("xr.html", root), "utf8"),
    readFile(new URL("vendor/audio/spectral-trail-ar.js", root), "utf8")
  ]);
  assert.match(html, /createSpectralTrailExtension/);
  assert.match(html, /spatialAudioAnalyser\.fftSize\s*=\s*256/);
  assert.match(html, /spectralTrailExtension\.place/);
  assert.match(html, /spectralTrailExtension\.update\(time,frame,referenceSpace\)/);
  assert.match(spectral, /const BINS = 48/);
  assert.match(spectral, /const LAYERS = 48/);
  assert.match(spectral, /SAMPLE_INTERVAL_MS = 66/);
  assert.match(spectral, /createAnchor/);
  assert.match(spectral, /state\.scale = THREE\.MathUtils\.clamp/);
  assert.match(spectral, /state\.autoRotate = !state\.autoRotate/);
});

test("offers optional automatic rotation for every requested 3D viewer", async () => {
  const files = await Promise.all([
    "vendor/cubejs/rubik-ar.js",
    "vendor/chronos/chronos-ar.js",
    "vendor/chemrender3d/protein-ar.js"
  ].map((path) => readFile(new URL(path, root), "utf8")));
  for (const source of files) {
    assert.match(source, /autoRotate/);
    assert.match(source, /rotation .*enabled.*disabled/s);
  }
});
