import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/", import.meta.url);

test("keeps a three-page reading window and requests bounded bridge images", async () => {
  const source = await readFile(new URL("xr.html", root), "utf8");
  assert.match(source, /imageMaxWidth: 1920, imageMaxHeight: 1080/);
  assert.match(source, /maxWidth: 1920, maxHeight: 1080/);
  assert.match(source, /warmDeferredNotePageWindow/);
  assert.match(source, /centerIndex - 1/);
  assert.match(source, /centerIndex \+ 1/);
  assert.match(source, /canvas\.width = 1/);
});

test("throttles hidden optional 3D extensions", async () => {
  const source = await readFile(new URL("xr.html", root), "utf8");
  assert.match(source, /function extensionNeedsFrame/);
  for (const path of [
    "vendor/cubejs/rubik-ar.js",
    "vendor/chronos/chronos-ar.js",
    "vendor/chemrender3d/protein-ar.js",
    "vendor/audio/spectral-trail-ar.js"
  ]) {
    const module = await readFile(new URL(path, root), "utf8");
    assert.match(module, /getObject:\(\)=>group/);
  }
});
