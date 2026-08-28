import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shouldPauseGraphRotation} from '../public/graph-rotation-policy.js';
test('menu, raw pinch, keyboard and note UI never pause automatic graph rotation',()=>{
 for(const interaction of ['menu','pinch','keyboard-open','keyboard-close','select','rotate','scale']) {
   assert.equal(shouldPauseGraphRotation({keyboardOpen:true,noteOpen:false,interaction}),false);
   assert.equal(shouldPauseGraphRotation({keyboardOpen:false,noteOpen:true,interaction}),false);
 }
 for(const interaction of ['menu','pinch','keyboard-open','keyboard-close'])assert.equal(shouldPauseGraphRotation({interaction}),false);
 for(const interaction of ['select','rotate','scale'])assert.equal(shouldPauseGraphRotation({interaction}),true);
});
test('opening and closing keyboard do not mutate rotation; keys survive disposal and prewarm before XR',async()=>{
 const source=await readFile(new URL('../public/xr.html',import.meta.url),'utf8');
 const open=source.slice(source.indexOf('    function openKeyboardSearch()'),source.indexOf('    function submitKeyboardSearch'));
 const close=source.slice(source.indexOf('    function closeKeyboardSearch()'),source.indexOf('    function toggleKeyboardSearch'));
 assert.doesNotMatch(open+close,/graphAutoRotating\s*=|keyboardPreservedGraphRotation/);
 assert.match(source,/if \(graphAutoRotating && isPlaced\)/);
 assert.match(source,/if \(arSearchKeyboardActive \|\| arNoteGroup.visible\) return/);
 assert.match(source,/graphAutoRotating && pinchTravel < 0\.025/);
 assert.match(source,/keyboardKeyTextureCache.has\(cacheKey\)/);
 assert.match(source,/!object.material\?\.map\?\.userData\?\.keyboardShared/);
 assert.match(source,/if \(xrSession\) return; \/\/ Never compete/);
 assert.match(source,/renderer.initTexture\(cachedKeyboardKeyTexture/);
 assert.match(source,/height:128/);
});
