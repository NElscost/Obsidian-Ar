// Source coordinates are preserved for media hit targets and playback markers.
export function contentPageRanges(ink, atoms, pageHeight = 570) {
  const content = ink.filter(r => Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom > r.top)
    .map(r => ({ top:Math.max(0,r.top), bottom:Math.max(0,r.bottom) })).sort((a,b)=>a.top-b.top);
  if (!content.length) return [{top:0,bottom:pageHeight}]; // Truly empty note: one page.
  const merged=[];
  for(const item of content){const last=merged.at(-1);if(last&&item.top<=last.bottom+.5)last.bottom=Math.max(last.bottom,item.bottom);else merged.push({...item});}
  const blocks=atoms.filter(a=>Number.isFinite(a.top)&&Number.isFinite(a.bottom)&&a.bottom>a.top&&a.bottom-a.top<=pageHeight).sort((a,b)=>a.top-b.top);
  // Leave a small capture gutter for glyph descenders, antialiasing and transformed media.
  const usableHeight=Math.max(1,pageHeight-12);
  const end=merged.at(-1).bottom,ranges=[];let top=0,index=0;
  while(top<end-.01){
    while(index<merged.length&&merged[index].bottom<=top+.01)index++;
    if(index===merged.length)break;
    // Skip whitespace-only regions without rasterizing or scanning canvas pixels.
    if(merged[index].top>top+2)top=Math.max(top,merged[index].top-2);
    let bottom=Math.min(top+usableHeight,end);
    const crossing=blocks.find(a=>a.top>top+2&&a.top<bottom-.5&&a.bottom>bottom+.5);
    if(crossing)bottom=crossing.top;
    // A block already beginning this page may use the reserved gutter when needed.
    const leadingBlock=blocks.find(a=>a.top<=top+2&&a.bottom>bottom&&a.bottom-top<=pageHeight);
    if(leadingBlock)bottom=Math.min(top+pageHeight,leadingBlock.bottom);
    const hasInk=merged.some(r=>r.bottom>top+.01&&r.top<bottom-.01);
    if(hasInk)ranges.push({top,bottom});
    top=bottom;
  }
  return ranges.length?ranges:[{top:0,bottom:pageHeight}];
}

export function measureVisibleNoteContent(container) {
  const origin=container.getBoundingClientRect(),ink=[];
  const visibility=new WeakMap();
  const visible=element=>{
    if(visibility.has(element))return visibility.get(element);
    const style=getComputedStyle(element);
    const own=style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&Number(style.opacity)!==0;
    const result=own&&(element===container||!element.parentElement||visible(element.parentElement));
    visibility.set(element,result);return result;
  };
  const add=rect=>{if(rect.width>0&&rect.height>0)ink.push({top:rect.top-origin.top,bottom:rect.bottom-origin.top});};
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT),range=document.createRange();
  while(walker.nextNode()){
    const node=walker.currentNode,parent=node.parentElement;
    if(!node.textContent.trim()||!parent||parent.closest('script,style,template')||!visible(parent))continue;
    range.selectNodeContents(node);
    for(const rect of range.getClientRects())add(rect);
  }
  for(const element of container.querySelectorAll('img,svg,canvas,video,audio,hr,.note-video-card,.note-audio-card,.note-timestamp-card,.note-music-abc,.note-midi-viz,.note-chess,.note-rubik,.note-protein,.note-mermaid,.note-gene-code,.note-chronos,.note-smiles')){
    if(visible(element))add(element.getBoundingClientRect());
  }
  return ink;
}
