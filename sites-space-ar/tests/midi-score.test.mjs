import test from 'node:test';
import assert from 'node:assert/strict';
import {spellPitch,keyAlterations,ledgerLines,scoreIndex,activeScoreNotes,layoutScorePage,chooseStaff,notesInScoreWindow,drawScore,drawScoreHighlights} from '../public/midi-score.js';
const note=(pitch,start,extra={})=>({pitch,start,duration:1,startBeat:start,quantizedStartBeat:start,quantizedDurationBeats:1,measure:Math.floor(start/4)+1,hand:1,...extra});
test('enharmonic spelling positions flats and key-implied E#/Cb on their correct staff degree',()=>{
 assert.equal(spellPitch(61,-3).letter,'D');assert.equal(spellPitch(61,-3).alter,-1);
 assert.equal(spellPitch(65,6).letter,'E');assert.equal(spellPitch(65,6).alter,1);
 assert.equal(spellPitch(59,-7).letter,'C');assert.equal(spellPitch(59,-7).octave,4);
 assert.equal(keyAlterations(2).F,1);assert.equal(keyAlterations(-2).E,-1);
});
test('ledger lines are outside the staff, not across it or for the first external space',()=>{
 assert.deepEqual(ledgerLines(245,154),[244]);assert.deepEqual(ledgerLines(235,154),[]);
 assert.deepEqual(ledgerLines(135,154),[136]);assert.deepEqual(ledgerLines(154,154),[]);
});
test('accidentals follow the signature, carry within a measure, cancel, and reset next measure',()=>{
 const data={notes:[note(66,0),note(65,1),note(65,2),note(66,3),note(66,4)],keySignatures:[{beat:0,sharps:1,name:'G'}]};
 const layout=layoutScorePage(data,0);
 assert.deepEqual([...layout.glyphs.values()].map(g=>g.accidental),['','♮','','♯','']);
 const flat=layoutScorePage({notes:[note(61,0)],keySignatures:[{beat:0,sharps:-3}]},0);
 assert.equal(flat.glyphs.get(0).step,29); // Db4, not C#4.
});
test('all active chord notes remain highlighted through sustain, seeks, and exact endpoints',()=>{
 const index=scoreIndex({notes:[note(60,0,{duration:10}),note(64,0),note(67,.5),note(72,9)]});
 assert.deepEqual(activeScoreNotes(index,.75).sort(),[0,1,2]);
 assert.deepEqual(activeScoreNotes(index,1).sort(),[0,2]);
 assert.deepEqual(activeScoreNotes(index,9.5).sort(),[0,3]);
 assert.deepEqual(activeScoreNotes(index,.25).sort(),[0,1]);
 assert.deepEqual(activeScoreNotes(index,10),[]);
 assert.deepEqual(notesInScoreWindow(index,8,9).map(n=>n.pitch),[60,72]);
});
test('chord seconds are staggered, extreme registers get explicit octave indications',()=>{
 const layout=layoutScorePage({notes:[note(60,0),note(62,0),note(64,0)]},0);
 assert.notEqual(layout.glyphs.get(0).x,layout.glyphs.get(1).x);
 assert.equal(chooseStaff([{step:49},{step:50}],'treble').octave,1);
});
test('score drawing and highlighting share glyph strokes without rerendering the background',()=>{
 const calls=[],ctx=new Proxy({},{get:(_,key)=> (...args)=>calls.push([key,...args]),set:()=>true});
 const layout=layoutScorePage({notes:[note(60,0),note(64,0)]},0);
 drawScore(ctx,layout,{});calls.length=0;drawScoreHighlights(ctx,layout,[0,1]);
 assert.equal(calls.filter(c=>c[0]==='ellipse').length,2);
 assert.equal(calls.filter(c=>c[0]==='fillRect').length,0);
});
