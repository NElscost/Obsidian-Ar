export function createChronosExtension(THREE, api) {
  const COLORS = { red:"#ff6b6b",orange:"#ff922b",yellow:"#ffd43b",green:"#63e6be",blue:"#75a7ff",purple:"#b197fc",pink:"#f783ac",cyan:"#66d9e8" };
  let group=null, texture=null, controls=[], state=null, contentGroup=null;

  function scalar(raw){
    const m=String(raw??"").trim().match(/^(-?\d{1,6})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:T(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/);
    if(!m)return NaN;
    const year=Number(m[1]),month=Math.max(1,Number(m[2]||1)),day=Math.max(1,Number(m[3]||1));
    return year+(month-1)/12+(day-1)/372+Number(m[4]||0)/8928+Number(m[5]||0)/535680+Number(m[6]||0)/32140800;
  }
  function parse(source){
    const events=[],flags={};
    for(const original of String(source??"").split(/\r?\n/)){
      const line=original.trim(); if(!line||line.startsWith("#"))continue;
      if(line.startsWith(">")){const m=line.match(/^>\s*([A-Z]+)\s*(.*)$/i);if(m)flags[m[1].toUpperCase()]=m[2].trim();continue;}
      const m=line.match(/^([-@*=])\s*\[([^\]]+)\]\s*(?:#(red|orange|yellow|green|blue|purple|pink|cyan))?\s*(?:\{([^}]+)\})?\s*([^|]*?)(?:\s*\|\s*(.*))?$/i);
      if(!m)continue;
      const dates=m[2].split("~"),start=scalar(dates[0]),end=scalar(dates[1]??dates[0]); if(!Number.isFinite(start)||!Number.isFinite(end))continue;
      events.push({type:m[1],rawStart:dates[0].trim(),rawEnd:(dates[1]??dates[0]).trim(),start,end:Math.max(start,end),color:COLORS[(m[3]||"").toLowerCase()]||"#75a7ff",group:(m[4]||"Timeline").trim(),label:(m[5]||dates[0]).trim(),description:(m[6]||"").trim()});
    }
    const view=String(flags.DEFAULTVIEW||"").split("|").map(scalar);
    const min=Number.isFinite(view[0])?view[0]:Math.min(...events.map(e=>e.start));
    const max=Number.isFinite(view[1])?view[1]:Math.max(...events.map(e=>e.end));
    return {events,flags,min:Number.isFinite(min)?min:0,max:Number.isFinite(max)&&max>min?max:min+1,selected:-1,tilt:0,hitboxes:[]};
  }
  function yearLabel(value){const rounded=Math.round(value);return rounded<0?`${Math.abs(rounded)} BCE`:String(rounded);}
  function ellipsis(ctx,text,width){let value=String(text);if(ctx.measureText(value).width<=width)return value;while(value.length>2&&ctx.measureText(value+"…").width>width)value=value.slice(0,-1);return value+"…";}
  function draw(canvas,s,compact=false){
    const ctx=canvas.getContext("2d",{alpha:true});ctx.clearRect(0,0,canvas.width,canvas.height);
    const W=canvas.width,H=canvas.height,pad=compact?24:90,top=compact?38:82,bottom=compact?28:78;
    ctx.fillStyle=compact?"rgba(8,16,29,.72)":"rgba(8,16,29,.9)";ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#f4f7ff";ctx.font=`700 ${compact?22:34}px system-ui`;ctx.textAlign="center";ctx.fillText(`Timeline · ${s.events.length} events`,W/2,compact?27:43);
    const groups=[...new Set(s.events.map(e=>e.group))],laneH=Math.max(compact?28:42,(H-top-bottom)/Math.max(1,groups.length));
    const x=v=>pad+(v-s.min)/Math.max(1e-9,s.max-s.min)*(W-pad*2);
    ctx.strokeStyle="rgba(190,215,255,.22)";ctx.lineWidth=1;
    for(let i=0;i<=5;i++){const px=pad+(W-pad*2)*i/5;ctx.beginPath();ctx.moveTo(px,top-8);ctx.lineTo(px,H-bottom+8);ctx.stroke();ctx.fillStyle="#9fb0c8";ctx.font=`${compact?13:18}px system-ui`;ctx.textAlign="center";ctx.fillText(yearLabel(s.min+(s.max-s.min)*i/5),px,H-bottom+(compact?18:28));}
    s.hitboxes=[];
    groups.forEach((name,lane)=>{const cy=top+laneH*(lane+.5);if(!compact){ctx.fillStyle="#9fb0c8";ctx.font="600 17px system-ui";ctx.textAlign="right";ctx.fillText(ellipsis(ctx,name,pad-14),pad-10,cy+5);}ctx.strokeStyle="rgba(190,215,255,.12)";ctx.beginPath();ctx.moveTo(pad,cy+laneH*.36);ctx.lineTo(W-pad,cy+laneH*.36);ctx.stroke();
      s.events.forEach((e,index)=>{if(e.group!==name)return;const x1=x(e.start),x2=x(e.end),selected=index===s.selected,color=e.color;
        if(e.type==="="){ctx.strokeStyle=color;ctx.lineWidth=selected?6:3;ctx.beginPath();ctx.moveTo(x1,top-4);ctx.lineTo(x1,H-bottom+5);ctx.stroke();}
        else if(e.type==="@"||e.end>e.start+.00001){ctx.fillStyle=e.type==="@"?color+"35":color+(selected?"ff":"c8");ctx.fillRect(x1,cy-(selected?13:9),Math.max(5,x2-x1),selected?26:18);}
        else {ctx.fillStyle=color;ctx.beginPath();ctx.arc(x1,cy,selected?11:7,0,Math.PI*2);ctx.fill();}
        const bx=Math.min(x1,x2)-10,bw=Math.max(22,Math.abs(x2-x1)+20),by=cy-laneH*.42,bh=laneH*.84;s.hitboxes.push({index,x:bx,y:by,width:bw,height:bh});
        ctx.fillStyle=selected?"#ffffff":"#dce8ff";ctx.font=`${selected?700:600} ${compact?12:16}px system-ui`;ctx.textAlign="left";ctx.fillText(ellipsis(ctx,e.label,compact?120:210),Math.min(x1+7,W-pad-100),cy-(selected?15:11));
      });
    });
    if(!compact&&s.selected>=0){const e=s.events[s.selected];ctx.fillStyle="rgba(8,16,29,.94)";ctx.fillRect(pad,H-54,W-pad*2,44);ctx.fillStyle=e.color;ctx.font="700 17px system-ui";ctx.textAlign="left";ctx.fillText(ellipsis(ctx,`${e.rawStart}${e.rawEnd!==e.rawStart?` – ${e.rawEnd}`:""} · ${e.label}${e.description?` — ${e.description}`:""}`,W-pad*2-18),pad+9,H-27);}
    return canvas;
  }
  async function renderBlocks(root){for(const el of root.querySelectorAll(".note-chronos")){let source=el.dataset.noteChronos||"";try{source=decodeURIComponent(source);}catch{}const parsed=parse(source),canvas=document.createElement("canvas");canvas.width=900;canvas.height=Math.min(420,Math.max(150,70+new Set(parsed.events.map(e=>e.group)).size*42));draw(canvas,parsed,true);const img=document.createElement("img");img.className="note-chronos-image";img.alt=`Timeline with ${parsed.events.length} events`;img.src=canvas.toDataURL("image/webp",.78);el.textContent="";el.append(img);}}
  function icon(control,label){const c=document.createElement("canvas");c.width=c.height=64;const cx=c.getContext("2d");cx.fillStyle="#07111f";cx.font="700 38px system-ui";cx.textAlign="center";cx.textBaseline="middle";cx.fillText(label,32,33);const t=new THREE.CanvasTexture(c),m=new THREE.Mesh(new THREE.PlaneGeometry(.024,.024),new THREE.MeshBasicMaterial({map:t,transparent:true,depthTest:false,toneMapped:false}));m.position.z=.003;m.raycast=()=>{};control.add(m);}
  function addControl(action,x,label,color=0x75a7ff){const c=new THREE.Mesh(new THREE.CircleGeometry(.016,14),new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false}));c.position.set(x,-api.height/2+.026,.05);c.userData.noteAction=action;c.userData.highlightScale=false;icon(c,label);contentGroup.add(c);controls.push(c);api.addControl(c);}
  function refresh(){if(!state||!texture)return;draw(texture.image,state,false);texture.needsUpdate=true;}
  function dispose(){const owned=new Set(controls);api.removeControls(owned);api.unregister(group,false);if(group){group.removeFromParent();group.traverse(o=>{o.geometry?.dispose?.();if(o.material?.map!==texture)o.material?.map?.dispose?.();o.material?.dispose?.();});}texture?.dispose();group=null;texture=null;controls=[];state=null;contentGroup=null;api.layout();}
  function open(source){dispose();state=parse(source);group=new THREE.Group();group.name="chronos-window";contentGroup=new THREE.Group();group.add(contentGroup);const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=640;draw(canvas,state,false);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;const panel=new THREE.Mesh(api.geometry(api.width,api.height,.022,24),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:true,depthWrite:true,toneMapped:false}));api.round(panel);panel.position.z=.025;panel.raycast=()=>{};contentGroup.add(panel);
    for(const hit of state.hitboxes){const c=new THREE.Mesh(new THREE.PlaneGeometry(Math.max(.018,hit.width/1024*api.width),Math.max(.018,hit.height/640*api.height)),new THREE.MeshBasicMaterial({colorWrite:false,transparent:true,opacity:0,depthTest:false,depthWrite:false}));c.position.set((hit.x+hit.width/2)/1024*api.width-api.width/2,api.height/2-(hit.y+hit.height/2)/640*api.height,.055);c.userData.noteAction=`chronos-event:${hit.index}`;c.userData.highlightScale=false;contentGroup.add(c);controls.push(c);api.addControl(c);}
    addControl("chronos-rotate-left",-.055,"↶");addControl("chronos-rotate-right",0,"↷");addControl("chronos-close",api.width/2-.028,"×",0xff6b6b);api.register(group,api.width);api.message(`Timeline ready · ${state.events.length} events.`);}
  function handle(action){if(action==="chronos-close"){dispose();api.message("Timeline closed.");return true;}if(action==="chronos-rotate-left"||action==="chronos-rotate-right"){state.tilt=THREE.MathUtils.clamp(state.tilt+(action.endsWith("right")?-.12:.12),-.5,.5);contentGroup.rotation.y=state.tilt;return true;}if(action.startsWith("chronos-event:")){const index=Number(action.slice(14));if(Number.isInteger(index)&&state?.events[index]){state.selected=index;refresh();const e=state.events[index];api.message(`${e.label}${e.description?` · ${e.description}`:""}`);}return true;}return false;}
  return {parse,draw,renderBlocks,open,dispose,handle};
}
