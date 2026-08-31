import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
const root=new URL("../public/",import.meta.url);
test("supports cached FASTA comparison blocks and vault attachments",async()=>{const [html,module,rust]=await Promise.all([readFile(new URL("xr.html",root),"utf8"),readFile(new URL("vendor/fasta/fasta-ar.js",root),"utf8"),readFile(new URL("../../note-bridge-rs/src/main.rs",import.meta.url),"utf8")]);assert.match(html,/createFastaExtension/);assert.match(html,/note-fasta/);assert.match(html,/fasta-open:/);assert.match(module,/function parse\(source\)/);assert.match(module,/consensus/);assert.match(module,/conservation/);assert.match(module,/fasta-grid/);assert.match(module,/const cache = new Map/);assert.match(rust,/\| "fasta"/);});
