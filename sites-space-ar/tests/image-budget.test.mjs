import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the world map outside Brazil and invalidates the old module cache", async () => {
  const xr = await readFile(new URL("../public/xr.html", import.meta.url), "utf8");
  const map = await readFile(new URL("../public/vendor/species-map/species-map.js", import.meta.url), "utf8");
  assert.match(xr, /species-map\.js\?v=11/);
  assert.match(map, /brazil \? brazilSpeciesMapRaster\(source\) : globalSpeciesMapRaster\(source\)/);
  assert.match(map, /1920 \/ source\.width/);
  assert.match(map, /1080 \/ source\.height/);
});

test("bounds note images to Full HD before they enter the reading texture", async () => {
  const xr = await readFile(new URL("../public/xr.html", import.meta.url), "utf8");
  assert.match(xr, /downscaleNoteImageBlob/);
  assert.match(xr, /maxWidth = 1920/);
  assert.match(xr, /maxHeight = 1080/);
  assert.match(xr, /const preparedBlob = await downscaleNoteImageBlob\(blob\)/);
});
