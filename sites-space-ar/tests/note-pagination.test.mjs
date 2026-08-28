import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPageRanges} from '../public/note-pagination.js';
test('ignores leading/trailing margins and gaps instead of emitting empty pages',()=>{
 const ink=[{top:700,bottom:730},{top:2200,bottom:2250}];
 const pages=contentPageRanges(ink,[]);
 assert.equal(pages.length,2);
 for(const p of pages)assert.ok(ink.some(r=>r.top<p.bottom&&r.bottom>p.top));
 assert.equal(pages.at(-1).bottom,2250);
});
test('keeps indivisible media on the next page and preserves source coordinates',()=>{
 const image={top:400,bottom:940};
 const pages=contentPageRanges([{top:20,bottom:80},image],[image]);
 assert.deepEqual(pages,[{top:18,bottom:400},{top:400,bottom:940}]);
 assert.ok(!pages.some(p=>p.top>image.top&&p.top<image.bottom));
});
test('does not drop text or media-only notes, long blocks, empty notes or small final lines',()=>{
 assert.deepEqual(contentPageRanges([{top:22,bottom:562}],[{top:22,bottom:562}]),[{top:20,bottom:562}]);
 assert.equal(contentPageRanges([{top:0,bottom:1200}],[]).length,3);
 assert.equal(contentPageRanges([],[]).length,1);
 assert.equal(contentPageRanges([{top:0,bottom:570},{top:572,bottom:573}],[]).length,2);
});
test('nested blocks never produce zero-height ranges and invalid measurements are ignored',()=>{
 const ink=[{top:20,bottom:100},{top:500,bottom:1000}],atoms=[{top:480,bottom:1020},{top:500,bottom:1000}];
 const pages=contentPageRanges([...ink,{top:NaN,bottom:Infinity}],atoms);
 assert.ok(pages.every(p=>p.bottom>p.top&&p.bottom-p.top<=570));
 assert.ok(pages.every(p=>ink.some(i=>i.top<p.bottom&&i.bottom>p.top)));
});
