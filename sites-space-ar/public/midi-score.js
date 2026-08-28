// Notation is prepared once; playback visits events rather than rescanning notes.
const LETTERS='CDEFGAB', PCS=[0,2,4,5,7,9,11], caches=new WeakMap();
export function keyAlterations(sharps=0){const result=Object.fromEntries([...LETTERS].map(l=>[l,0]));for(const l of (sharps<0?'BEADGCF':'FCGDAEB').slice(0,Math.min(7,Math.abs(sharps))))result[l]=Math.sign(sharps);return result;}
export function spellPitch(pitch,sharps=0){
 const signature=keyAlterations(sharps),choices=[];
 for(let degree=0;degree<7;degree++)for(let alter=-1;alter<=1;alter++){
  if(((PCS[degree]+alter)%12+12)%12!==pitch%12)continue;
  const letter=LETTERS[degree],octave=Math.round((pitch-PCS[degree]-alter)/12)-1;
  choices.push({letter,alter,octave,step:octave*7+degree,cost:(alter===signature[letter]?0:3)+Math.abs(alter)*.1+(sharps<0?alter>0:alter<0)*.2});
 }
 return choices.sort((a,b)=>a.cost-b.cost)[0];
}
export function ledgerLines(y,top,gap=18){const bottom=top+4*gap,result=[];for(let line=top-gap;line>=y-.01;line-=gap)result.push(line);for(let line=bottom+gap;line<=y+.01;line+=gap)result.push(line);return result;}
function atBeat(items,beat,fallback){let result=fallback;for(const item of items||[]){if(item.beat<=beat)result=item;}return result;}
function upperBound(items,time,value){let l=0,r=items.length;while(l<r){const m=(l+r)>>1;if(value(items[m])<=time)l=m+1;else r=m;}return l;}
export function scoreIndex(data){
 if(caches.has(data))return caches.get(data);
 const notes=data.notes||[],pages=new Map(),starts=[],events=[],prefixEnds=[];
 const supplied=data.playbackEvents,hasEvents=Array.isArray(supplied)&&supplied.length===notes.length*2,hasPages=data.scorePages&&typeof data.scorePages==='object';
 for(let id=0;id<notes.length;id++){
  const n=notes[id],measure=Math.max(1,Number(n.measure)||1),page=Math.floor((measure-1)/4);
  if(!hasPages){if(!pages.has(page))pages.set(page,[]);pages.get(page).push(id);}starts.push(id);
  if(!hasEvents)events.push({time:n.start,note:id,on:true},{time:n.start+Math.max(0,n.duration),note:id,on:false});
 }
 starts.sort((a,b)=>notes[a].start-notes[b].start);
 let max=0;for(const id of starts){max=Math.max(max,notes[id].start+notes[id].duration);prefixEnds.push(max);}
 // New bridges supply a pre-sorted event index; old bridges still work.
 if(data.scorePages && typeof data.scorePages === "object"){pages.clear();for(const [page,ids] of Object.entries(data.scorePages)){if(Array.isArray(ids))pages.set(Number(page),ids.filter(id=>Number.isInteger(id)&&id>=0&&id<notes.length));}}
 const sorted=hasEvents?supplied:events.sort((a,b)=>a.time-b.time||Number(a.on)-Number(b.on));
 const index={notes,pages,starts,prefixEnds,events:sorted,active:new Set(),cursor:0,time:-Infinity};caches.set(data,index);return index;
}
export function activeScoreNotes(index,time){
 const {notes,events}=index;
 if(time<index.time||time-index.time>1){
  index.active.clear();const end=upperBound(index.starts,time,id=>notes[id].start);
  for(let i=end-1;i>=0&&index.prefixEnds[i]>time;i--){const id=index.starts[i],n=notes[id];if(n.start<=time&&n.start+n.duration>time)index.active.add(id);}
  index.cursor=upperBound(events,time,e=>e.time);
 }else{
  while(index.cursor<events.length&&events[index.cursor].time<=time){const e=events[index.cursor++];if(e.on&&notes[e.note].duration>0)index.active.add(e.note);else index.active.delete(e.note);}
 }
 index.time=time;return [...index.active];
}
export function chooseStaff(notes,preferred){
 let best=null;
 for(const clef of ['treble','bass'])for(const octave of [0,1,-1]){
  const base=clef==='treble'?30:18;
  const cost=notes.reduce((sum,n)=>{const step=n.step-octave*7;return sum+Math.max(0,base-step-1)+Math.max(0,step-base-9);},0)/Math.max(1,notes.length)+(clef===preferred?0:.6)+Math.abs(octave)*1.3;
  if(!best||cost<best.cost)best={clef,octave,base,cost};
 }return best;
}
export function layoutScorePage(data,page){
 const index=scoreIndex(data),ids=index.pages.get(page)||[],beats=Math.max(.25,(Number(data.beatsPerMeasure)||4)*4/(Number(data.beatUnit)||4));
 const first=page*4+1,firstBeat=(first-1)*beats,tops=[154,374],gap=18;
 const prepared=ids.map(id=>{const note=index.notes[id],beat=Number(note.quantizedStartBeat??note.startBeat)||0,key=atBeat(data.keySignatures,beat,{sharps:0});return{id,note,beat,staff:note.hand===0?1:note.hand===1?0:note.pitch>=60?0:1,...spellPitch(note.pitch,key.sharps)};});
 const staffs=[0,1].map(staff=>chooseStaff(prepared.filter(n=>n.staff===staff),staff?'bass':'treble'));
 const counts=Array.from({length:4},(_,i)=>new Set(prepared.filter(n=>n.note.measure===first+i).map(n=>n.beat)).size);
 const weights=counts.map(n=>Math.max(3,n+2)),total=weights.reduce((a,b)=>a+b,0),bars=[];let x=168;
 for(let i=0;i<4;i++){const width=818*weights[i]/total;bars.push({measure:first+i,x,width});x+=width;}
 const accidentalState=[new Map(),new Map()],lastMeasure=[-1,-1],glyphs=new Map(),chords=new Map();
 prepared.sort((a,b)=>a.beat-b.beat||a.staff-b.staff||a.step-b.step);
 for(const n of prepared){
  const measure=Number(n.note.measure)||Math.floor(n.beat/beats)+1,bar=bars[Math.max(0,Math.min(3,measure-first))],signature=keyAlterations(atBeat(data.keySignatures,firstBeat,{sharps:0}).sharps);
  if(lastMeasure[n.staff]!==measure){accidentalState[n.staff].clear();lastMeasure[n.staff]=measure;}
  const accidentalKey=n.letter+n.octave,previous=accidentalState[n.staff].get(accidentalKey)??signature[n.letter];
  const accidental=previous===n.alter?'':n.alter===0?'♮':n.alter<0?'♭':'♯';accidentalState[n.staff].set(accidentalKey,n.alter);
  const staff=staffs[n.staff],displayStep=n.step-staff.octave*7,y=tops[n.staff]+gap*4-(displayStep-staff.base)*gap/2;
  const chordKey=n.staff+':'+n.beat,previousChord=chords.get(chordKey),shift=previousChord&&Math.abs(previousChord.y-y)<10&&!previousChord.shift?12:0;
  const x=bar.x+22+Math.max(0,Math.min(1,(n.beat-(measure-1)*beats)/beats))*(bar.width-40)+shift;
  const duration=Number(n.note.quantizedDurationBeats??n.note.durationBeats)||1,stemUp=y>tops[n.staff]+gap*2;
  const tieEnd=n.beat+duration>measure*beats+.01?bar.x+bar.width-4:null;
  const glyph={id:n.id,x,y,tieEnd,staff:n.staff,step:n.step,duration,stemUp,accidental,dotted:n.note.dotted,ledgers:ledgerLines(y,tops[n.staff],gap),shift};
  glyphs.set(n.id,glyph);chords.set(chordKey,glyph);
 }
 return{page,first,firstBeat,beats,tops,gap,staffs,bars,glyphs,key:atBeat(data.keySignatures,firstBeat,{sharps:0,name:'C'}),tempo:atBeat(data.tempoMap,firstBeat,{bpm:120}),title:data.title||'MIDI'};
}
function drawGlyph(ctx,g,color){
 ctx.fillStyle=ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(g.x,g.y,7,5,-.22,0,Math.PI*2);g.duration<2?ctx.fill():ctx.stroke();
 if(g.duration<4){const sx=g.x+(g.stemUp?6:-6),end=g.y+(g.stemUp?-31:31);ctx.beginPath();ctx.moveTo(sx,g.y);ctx.lineTo(sx,end);ctx.stroke();if(g.duration<=.5){ctx.beginPath();ctx.moveTo(sx,end);ctx.quadraticCurveTo(sx+(g.stemUp?13:-13),end+8,sx+(g.stemUp?5:-5),end+19);ctx.stroke();}}
 if(g.accidental){ctx.font='22px serif';ctx.textAlign='center';ctx.fillText(g.accidental,g.x-17,g.y+6);}
 if(g.dotted){ctx.beginPath();ctx.arc(g.x+12,g.y,2.2,0,Math.PI*2);ctx.fill();}
 if(g.tieEnd&&g.tieEnd>g.x+6){ctx.beginPath();ctx.moveTo(g.x+4,g.y+9);ctx.quadraticCurveTo((g.x+g.tieEnd)/2,g.y+24,g.tieEnd,g.y+9);ctx.stroke();}
 for(const y of g.ledgers){ctx.beginPath();ctx.moveTo(g.x-11,y);ctx.lineTo(g.x+11,y);ctx.stroke();}
}
export function drawScore(ctx,layout,data){
 ctx.clearRect(0,0,1024,600);ctx.fillStyle='#f6f1e8';ctx.fillRect(0,0,1024,600);ctx.fillStyle='#172033';ctx.textAlign='center';ctx.font='600 28px system-ui';ctx.fillText(layout.title+' · engraved score',512,40,950);ctx.font='17px system-ui';ctx.fillText(`${data.beatsPerMeasure||4}/${data.beatUnit||4} · ${layout.key.name||'C'} · ♩=${Math.round(layout.tempo.bpm||120)}`,512,68);
 layout.staffs.forEach((staff,i)=>{
  const top=layout.tops[i];ctx.strokeStyle='#69717c';ctx.lineWidth=1;
  for(let l=0;l<5;l++){ctx.beginPath();ctx.moveTo(24,top+l*18);ctx.lineTo(986,top+l*18);ctx.stroke();}
  ctx.fillStyle='#172033';ctx.textAlign='left';ctx.font='52px "Segoe UI Symbol","Noto Music",serif';ctx.fillText(staff.clef==='treble'?'𝄞':'𝄢',28,top+64);
  ctx.font='16px system-ui';if(staff.octave)ctx.fillText(staff.octave>0?'8va':'8vb',30,top-14);
  const count=Math.min(7,Math.abs(layout.key.sharps||0)),sharp=layout.key.sharps>=0;
  const positions=sharp?[0,3,-1,2,5,1,4]:[4,1,5,2,6,3,7];ctx.font='23px serif';
  for(let k=0;k<count;k++)ctx.fillText(sharp?'♯':'♭',73+k*10,top+positions[k]*9+(staff.clef==='bass'?18:0)+6);
  ctx.font='22px serif';ctx.fillText(String(data.beatsPerMeasure||4),146,top+25);ctx.fillText(String(data.beatUnit||4),146,top+51);
 });
 for(const bar of layout.bars){ctx.strokeStyle='#69717c';ctx.lineWidth=1.5;for(const top of layout.tops){ctx.beginPath();ctx.moveTo(bar.x,top);ctx.lineTo(bar.x,top+72);ctx.stroke();}ctx.fillStyle='#617087';ctx.font='14px system-ui';ctx.fillText(String(bar.measure),bar.x+4,layout.tops[0]-10);}
 for(const g of layout.glyphs.values())drawGlyph(ctx,g,'#172033');
 for(const bar of layout.bars)for(let staff=0;staff<2;staff++){if(![...layout.glyphs.values()].some(g=>g.staff===staff&&g.x>=bar.x&&g.x<bar.x+bar.width)){ctx.fillStyle='#172033';ctx.fillRect(bar.x+bar.width/2-8,layout.tops[staff]+34,16,5);}}
 ctx.fillStyle='#617087';ctx.textAlign='center';ctx.font='16px system-ui';ctx.fillText(`Measures ${layout.first}–${layout.first+3} · quantized display, exact MIDI playback`,512,582);
}
export function drawScoreHighlights(ctx,layout,ids){ctx.clearRect(0,0,1024,600);for(const id of ids){const g=layout.glyphs.get(id);if(g)drawGlyph(ctx,g,'#e69700');}}

export function notesInScoreWindow(index,from,to){
 const active=activeScoreNotes(index,from),begin=upperBound(index.starts,from,id=>index.notes[id].start),end=upperBound(index.starts,to,id=>index.notes[id].start);
 return active.concat(index.starts.slice(begin,end)).map(id=>index.notes[id]).sort((a,b)=>a.start-b.start);
}
