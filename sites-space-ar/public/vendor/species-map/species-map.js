const rasterCache = new Map();
const regionCache = new Map();
const regionPanelCache = new Map();

export function parseSpeciesMapConfig(source) {
  const config = { taxon: "", source: "gbif", mode: "density", center: [-15, -55], zoom: 2, style: "classic.point" };
  for (const line of String(source ?? "").split(/\r?\n/)) {
    const match = line.match(/^([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2];
    if (key === "taxon") config.taxon = value.trim().slice(0, 180);
    else if (key === "source") config.source = value.trim().toLowerCase();
    else if (key === "mode") config.mode = value.trim().toLowerCase();
    else if (key === "style") config.style = value.trim().replace(/[^a-z0-9.-]/gi, "") || config.style;
    else if (key === "zoom") config.zoom = Math.max(1, Math.min(5, Number.parseInt(value, 10) || 2));
    else if (key === "center") {
      const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      if (numbers?.length >= 2 && numbers.every(Number.isFinite)) config.center = [numbers[0], numbers[1]];
    }
  }
  return config;
}

function tileAt(lat, lon, zoom) {
  const scale = 2 ** zoom;
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.floor((lon + 180) / 360 * scale);
  const radians = safeLat * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale);
  return { x, y, scale };
}

async function decodeImage(blob) {
  if (!blob.size) return null;
  try { return await createImageBitmap(blob); }
  catch {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error ?? new Error("Image decode failed"));
      reader.readAsDataURL(blob);
    });
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();
    return image;
  }
}

async function bitmap(url, optional = false) {
  const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (optional && response.status === 204) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const image = await decodeImage(await response.blob());
  if (!image && !optional) throw new Error("Empty image response");
  return image;
}

async function resolveTaxonKey(taxon) {
  const response = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(taxon)}`, {
    credentials: "omit", cache: "force-cache"
  });
  if (!response.ok) throw new Error(`GBIF taxon HTTP ${response.status}`);
  const result = await response.json();
  const key = Number(result.usageKey ?? result.speciesKey);
  if (!Number.isFinite(key)) throw new Error(`Taxon not found: ${taxon}`);
  return { key, scientificName: result.scientificName || taxon };
}

async function occurrenceClusters(config, taxonKey, center) {
  const northWest = mapCoordinate(config, 0, 0), southEast = mapCoordinate(config, 1, 1);
  const query = new URLSearchParams({ taxonKey:String(taxonKey), hasCoordinate:"true", limit:"300",
    decimalLatitude: Math.min(southEast.lat,northWest.lat)+","+Math.max(southEast.lat,northWest.lat) });
  if (northWest.lon < southEast.lon) query.set("decimalLongitude", northWest.lon+","+southEast.lon);
  const response=await fetch("https://api.gbif.org/v1/occurrence/search?"+query,{credentials:"omit",cache:"force-cache"});
  if(!response.ok)return [];
  const json=await response.json(), clusters=new Map();
  for(const record of json.results||[]){const lat=Number(record.decimalLatitude),lon=Number(record.decimalLongitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    let tx=(lon+180)/360*center.scale;while(tx<center.x-1)tx+=center.scale;while(tx>center.x+2)tx-=center.scale;
    const rad=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180,ty=(1-Math.asinh(Math.tan(rad))/Math.PI)/2*center.scale;
    const x=(tx-(center.x-1))/3*900,y=(ty-(center.y-1))/2*600;if(x<0||x>900||y<0||y>600)continue;
    const key=Math.floor(x/32)+":"+Math.floor(y/32),item=clusters.get(key)||{x:0,y:0,count:0};item.x+=x;item.y+=y;item.count++;clusters.set(key,item);
  }
  return [...clusters.values()].map(c=>({x:c.x/c.count,y:c.y/c.count,count:c.count}));
}

const BRAZIL_BOUNDS = { west: -74.2, east: -32.0, north: 5.6, south: -34.2 };
const BRAZIL_SHAPE = [[-73.9,-7.5],[-70.1,2.2],[-60.0,5.2],[-51.6,4.1],[-49.7,0.2],[-44.0,-2.5],[-34.8,-7.0],[-35.2,-13.0],[-38.7,-18.5],[-41.0,-22.8],[-48.5,-28.5],[-53.4,-33.7],[-57.7,-30.2],[-57.0,-22.1],[-61.5,-19.0],[-58.4,-13.0],[-65.2,-9.5],[-70.0,-11.0]];
let brazilGeometryPromise;
function brazilPoint(lon,lat){return{x:(lon-BRAZIL_BOUNDS.west)/(BRAZIL_BOUNDS.east-BRAZIL_BOUNDS.west)*720+90,y:(BRAZIL_BOUNDS.north-lat)/(BRAZIL_BOUNDS.north-BRAZIL_BOUNDS.south)*520+42}}
async function brazilGeometry(){if(!brazilGeometryPromise)brazilGeometryPromise=fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/BRA.geo.json',{credentials:'omit',cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('Brazil geometry HTTP '+r.status);return r.json()}).then(x=>x.geometry?.coordinates||x.features?.[0]?.geometry?.coordinates||[BRAZIL_SHAPE]).catch(()=>[BRAZIL_SHAPE]);return brazilGeometryPromise}
function brazilPath(context,geometry){const polygons=Array.isArray(geometry?.[0]?.[0]?.[0])?geometry:[geometry];context.beginPath();for(const polygon of polygons)for(const ring of polygon){ring.forEach(([lon,lat],i)=>{const q=brazilPoint(lon,lat);i?context.lineTo(q.x,q.y):context.moveTo(q.x,q.y)});context.closePath();}}
async function brazilOccurrences(taxonKey){const q=new URLSearchParams({taxon_key:String(taxonKey),country:'BR',has_coordinate:'true',limit:'1000'}),r=await fetch('https://api.gbif.org/v1/occurrence/search?'+q,{credentials:'omit',cache:'force-cache'});if(!r.ok)throw Error('GBIF occurrences HTTP '+r.status);return (await r.json()).results||[];}
export async function speciesMapRaster(source) {
 const config=parseSpeciesMapConfig(source);if(!config.taxon)throw Error('No taxon configured.');if(config.source!=='gbif')throw Error('Unsupported source: '+config.source);
 const cacheKey=JSON.stringify(config)+':biomes-v2';if(rasterCache.has(cacheKey))return rasterCache.get(cacheKey);
 const pending=(async()=>{const taxon=await resolveTaxonKey(config.taxon),[records,geometry]=await Promise.all([brazilOccurrences(taxon.key),brazilGeometry()]),canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const c=canvas.getContext('2d',{alpha:true});c.clearRect(0,0,900,600);
  c.save();brazilPath(c,geometry);c.clip();c.fillStyle='rgba(179,225,169,.88)';c.fillRect(0,0,900,600);
  c.fillStyle='rgba(126,205,108,.78)';c.beginPath();c.ellipse(275,190,245,170,-.25,0,Math.PI*2);c.fill();
  c.fillStyle='rgba(255,231,151,.76)';c.beginPath();c.ellipse(515,285,205,175,.22,0,Math.PI*2);c.fill();
  c.fillStyle='rgba(255,184,160,.72)';c.beginPath();c.ellipse(600,370,130,205,.3,0,Math.PI*2);c.fill();
  c.fillStyle='rgba(183,238,177,.9)';c.fillRect(548,180,52,350);c.fillStyle='rgba(255,224,238,.78)';c.beginPath();c.ellipse(335,420,140,75,0,0,Math.PI*2);c.fill();c.restore();
  brazilPath(c,geometry);c.strokeStyle='rgba(235,255,240,.88)';c.lineWidth=3;c.stroke();
  c.fillStyle='rgba(255,24,30,.9)';for(const r of records){const lon=Number(r.decimalLongitude),lat=Number(r.decimalLatitude);if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;const q=brazilPoint(lon,lat);c.beginPath();c.arc(q.x,q.y,2.2,0,Math.PI*2);c.fill();}
  const legend=[['Amazon','#7ecd6c'],['Caatinga','#ffe797'],['Cerrado','#ffb8a0'],['Atlantic Forest','#b7eeb1'],['Pampa','#ffe0ee']];c.font='600 14px system-ui';c.textAlign='left';legend.forEach((x,i)=>{const y=438+i*24;c.fillStyle=x[1];c.fillRect(105,y,16,16);c.fillStyle='#eaf3ff';c.fillText(x[0],130,y+13)});
  c.fillStyle='#f4f8ff';c.font='700 25px system-ui';c.fillText(taxon.scientificName,92,28);c.fillStyle='#ff3940';c.font='600 14px system-ui';c.fillText(records.length.toLocaleString()+' sampled occurrence points',565,574);
  return{dataUrl:canvas.toDataURL('image/webp',.88),config,taxon};})();rasterCache.set(cacheKey,pending);while(rasterCache.size>10)rasterCache.delete(rasterCache.keys().next().value);try{return await pending}catch(e){rasterCache.delete(cacheKey);throw e}
}
function mapCoordinate(config, u, v) {
  if (Math.abs(config.center[0] + 15) < 12 && Math.abs(config.center[1] + 55) < 18) return { lat: BRAZIL_BOUNDS.north - THREE_NUMBER((v * 600 - 42) / 520) * (BRAZIL_BOUNDS.north - BRAZIL_BOUNDS.south), lon: BRAZIL_BOUNDS.west + THREE_NUMBER((u * 900 - 90) / 720) * (BRAZIL_BOUNDS.east - BRAZIL_BOUNDS.west) };
  const center = tileAt(config.center[0], config.center[1], config.zoom);
  const tileX = center.x - 1 + THREE_NUMBER(u) * 3;
  const tileY = center.y - 1 + THREE_NUMBER(v) * 2;
  const lon = ((tileX / center.scale) * 360) - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / center.scale))) * 180 / Math.PI;
  return { lat: Math.max(-85, Math.min(85, lat)), lon: ((lon + 540) % 360) - 180 };
}
function THREE_NUMBER(value) { return Math.max(0, Math.min(0.999999, Number(value) || 0)); }

function regionLabel(results,point){const counts=new Map();for(const item of results||[]){const state=String(item.stateProvince||item.locality||"").trim(),country=String(item.country||"").trim(),name=state&&country?state+", "+country:state||country;if(name)counts.set(name,(counts.get(name)||0)+1)}return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||point.lat.toFixed(2)+"°, "+point.lon.toFixed(2)+"°"}
export async function speciesRegionRecords(source,u=.5,v=.5){const config=parseSpeciesMapConfig(source),taxon=await resolveTaxonKey(config.taxon),point=mapCoordinate(config,u,v),radius=Math.max(.35,55/(2**config.zoom)),key=JSON.stringify(config)+":"+point.lat.toFixed(2)+":"+point.lon.toFixed(2);if(regionCache.has(key))return regionCache.get(key);const pending=(async()=>{const base={taxon_key:String(taxon.key),has_coordinate:"true",decimal_latitude:Math.max(-89.9,point.lat-radius)+","+Math.min(89.9,point.lat+radius),decimal_longitude:Math.max(-179.9,point.lon-radius)+","+Math.min(179.9,point.lon+radius),limit:"24"},load=async type=>{const q=new URLSearchParams({...base,media_type:type}),r=await fetch("https://api.gbif.org/v1/occurrence/search?"+q,{credentials:"omit",cache:"force-cache"});if(!r.ok)throw Error("GBIF records HTTP "+r.status);return r.json();},[pj,sj]=await Promise.all([load("StillImage"),load("Sound")]),photos=[],sounds=[],seen=new Set();for(const occurrence of [...(pj.results||[]),...(sj.results||[])])for(const media of occurrence.media||[]){const url=String(media.identifier||"");if(!/^https:\/\//i.test(url)||seen.has(url))continue;const item={url,reference:media.references||occurrence.references||"",creator:media.creator||media.rightsHolder||"Unknown observer",license:media.license||"",place:occurrence.stateProvince||occurrence.locality||occurrence.country||"Selected region"};if(media.type==="StillImage"&&photos.length<6){photos.push(item);seen.add(url)}else if(media.type==="Sound"&&sounds.length<4){sounds.push(item);seen.add(url)}}return{config,taxon,point,name:regionLabel([...(pj.results||[]),...(sj.results||[])],point),count:Math.max(Number(pj.count)||0,Number(sj.count)||0),photos,sounds}})();regionCache.set(key,pending);while(regionCache.size>16)regionCache.delete(regionCache.keys().next().value);try{return await pending}catch(e){regionCache.delete(key);throw e}}

export async function speciesRegionPanelRaster(source, u, v) {
  const key=source+":"+Math.round(u*30)+":"+Math.round(v*30);if(regionPanelCache.has(key))return regionPanelCache.get(key);const pending=(async()=>{
  const result = await speciesRegionRecords(source, u, v);
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 640;
  const context = canvas.getContext("2d"); context.fillStyle = "rgba(5,12,23,.96)"; context.fillRect(0,0,1024,640);
  context.fillStyle = "#f3f8ff"; context.font = "700 34px system-ui"; context.fillText(result.taxon.scientificName, 34, 48);
  context.fillStyle = "#9fb2c9"; context.font = "22px system-ui"; context.fillText(`${result.name} · ${result.count.toLocaleString()} regional records`,34,82);
  const loaded = await Promise.allSettled(result.photos.slice(0,4).map((item)=>bitmap(item.url,true)));
  loaded.forEach((entry,index)=>{const x=34+(index%2)*310,y=112+Math.floor(index/2)*208;context.fillStyle="#142238";context.fillRect(x,y,292,180);if(entry.status==="fulfilled"&&entry.value){const image=entry.value,scale=Math.max(292/image.width,180/image.height),w=image.width*scale,h=image.height*scale;context.save();context.beginPath();context.rect(x,y,292,180);context.clip();context.drawImage(image,x+(292-w)/2,y+(180-h)/2,w,h);context.restore();image.close?.();}context.fillStyle="rgba(3,8,16,.78)";context.fillRect(x,y+148,292,32);context.fillStyle="#fff";context.font="17px system-ui";context.fillText(result.photos[index]?.creator?.slice(0,28)||"Photo",x+9,y+169);context.fillStyle="rgba(3,8,16,.82)";context.beginPath();context.arc(x+24,y+24,15,0,Math.PI*2);context.fill();context.strokeStyle="#fff";context.lineWidth=2;context.strokeRect(x+17,y+19,14,10);context.beginPath();context.arc(x+24,y+24,3,0,Math.PI*2);context.stroke();});
  context.fillStyle="#dce8f7"; context.font="700 25px system-ui"; context.fillText("Sounds",680,126);
  result.sounds.forEach((item,index)=>{const y=154+index*88;context.fillStyle=index%2?"#122238":"#172a43";context.fillRect(674,y,316,72);context.fillStyle="#73e6ce";context.font="700 21px system-ui";context.beginPath();context.arc(696,y+27,14,0,Math.PI*2);context.fill();context.fillStyle="#07111d";context.beginPath();context.moveTo(692,y+20);context.lineTo(702,y+27);context.lineTo(692,y+34);context.closePath();context.fill();context.fillStyle="#73e6ce";context.fillText("Recording "+(index+1),718,y+34);context.fillStyle="#b6c5d7";context.font="16px system-ui";context.fillText((item.creator||"Observer").slice(0,34),690,y+54);});
  if(!result.photos.length){context.fillStyle="#9fb2c9";context.font="24px system-ui";context.fillText("No photos found in this region.",34,150);}
  if(!result.sounds.length){context.fillStyle="#9fb2c9";context.font="22px system-ui";context.fillText("No sounds found in this region.",680,168);}
  context.fillStyle="#71849d";context.font="16px system-ui";context.fillText("Records: GBIF · media: original publishers · select another map region to refresh",34,620);
  return { ...result, canvas, dataUrl: canvas.toDataURL("image/webp",.82) };
  })();regionPanelCache.set(key,pending);while(regionPanelCache.size>12)regionPanelCache.delete(regionPanelCache.keys().next().value);try{return await pending}catch(e){regionPanelCache.delete(key);throw e}
}

function iucnScale(active,label,system){const cats=["EX","EW","CR","EN","VU","NT","LC"],scale=document.createElement("div");scale.className="note-iucn-scale";scale.style.cssText="margin:8px auto 10px;max-width:500px;color:#243142;text-align:center;font:600 13px system-ui;break-inside:avoid";const version=document.createElement("div");version.textContent=system||"IUCN 3.1";version.style.cssText="color:#68788d;font-size:10px";const title=document.createElement("div");title.textContent=label||active;title.style.cssText="margin-bottom:7px;color:#1167b1;font-weight:800";const row=document.createElement("div");row.style.cssText="display:flex;justify-content:center;gap:5px";for(const c of cats){const x=document.createElement("span");x.textContent=c;x.style.cssText="display:grid;place-items:center;width:27px;height:27px;border:1.5px solid "+(c===active?"#153c14":"#6f7781")+";border-radius:50%;background:"+(c===active?"#18aa24":"#fff")+";color:"+(c===active?"#fff":"#303840")+";font-size:11px;font-weight:800;box-sizing:border-box";row.append(x)}const labels=document.createElement("div");labels.style.cssText="display:grid;grid-template-columns:54px 135px 76px;justify-content:center;margin-top:4px;color:#555;font-size:10px;font-weight:500;line-height:1.1";labels.innerHTML="<span>Extinct</span><span>Threatened</span><span>Least concern</span>";scale.append(version,title,row,labels);return scale}
export function renderIucnBlocks(root){for(const block of root.querySelectorAll("[data-note-iucn]")){let source=block.dataset.noteIucn||"";try{source=decodeURIComponent(source)}catch{}const fields={};for(const line of source.split(/\r?\n/)){const match=line.match(/^([\w-]+)\s*:\s*(.+)$/);if(match)fields[match[1].toLowerCase()]=match[2].trim()}const candidate=String(fields.status||fields.category||source.trim()).toUpperCase(),active=["EX","EW","CR","EN","VU","NT","LC"].includes(candidate)?candidate:"LC";block.replaceChildren(iucnScale(active,fields.label||active,fields.system||"IUCN 3.1"))}}
export function renderIucnStatus(root){const cats=["EX","EW","CR","EN","VU","NT","LC"];for(const el of [...root.querySelectorAll("p,blockquote p")]){const text=(el.textContent||"").replace(/\s+/g," ").trim();if(!/IUCN\s*3\.1\s*:/i.test(text)||el.querySelector(".note-iucn-scale"))continue;const marked=el.querySelector("mark")?.textContent?.trim().toUpperCase(),active=cats.includes(marked)?marked:"LC",scale=document.createElement("div");scale.className="note-iucn-scale";scale.style.cssText="margin:8px auto 10px;max-width:500px;color:#243142;text-align:center;font:600 13px system-ui;break-inside:avoid";const title=document.createElement("div");title.textContent=active==="LC"?"Pouco Preocupante":"IUCN "+active;title.style.cssText="margin-bottom:7px;color:#1167b1;font-weight:800";const row=document.createElement("div");row.style.cssText="display:flex;justify-content:center;gap:5px";for(const c of cats){const x=document.createElement("span");x.textContent=c;x.style.cssText="display:grid;place-items:center;width:27px;height:27px;border:1.5px solid "+(c===active?"#153c14":"#6f7781")+";border-radius:50%;background:"+(c===active?"#18aa24":"#fff")+";color:"+(c===active?"#fff":"#303840")+";font-size:11px;font-weight:800;box-sizing:border-box";row.append(x)}const labels=document.createElement("div");labels.style.cssText="display:grid;grid-template-columns:54px 135px 76px;justify-content:center;margin-top:4px;color:#555;font-size:10px;font-weight:500;line-height:1.1";labels.innerHTML="<span>Extinta</span><span>Ameaçada</span><span>Pouco<br>preocupante</span>";scale.append(title,row,labels);el.replaceWith(scale)}}

export async function renderSpeciesMapBlocks(root) {
  renderIucnBlocks(root);
  renderIucnStatus(root);
  const blocks = [...root.querySelectorAll("[data-note-species-map]")];
  await Promise.all(blocks.map(async (block) => {
    let source = block.dataset.noteSpeciesMap || "";
    try { source = decodeURIComponent(source); } catch {}
    try {
      const result = await speciesMapRaster(source);
      const image = document.createElement("img");
      image.className = "note-species-map-image";
      image.alt = `Occurrence map for ${result.taxon.scientificName}`;
      image.src = result.dataUrl;
      image.dataset.speciesMapSource = encodeURIComponent(source);
      image.draggable = false;
      image.title = "Select a region to view photos and sounds";
      await image.decode();
      block.replaceChildren(image);
      block.style.position="relative";
      let pointerStart=null,suppressClick=false;
      image.addEventListener("pointerdown",event=>{pointerStart={x:event.clientX,y:event.clientY};suppressClick=false});
      image.addEventListener("pointermove",event=>{if(pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>7)suppressClick=true});
      image.addEventListener("pointerup",()=>{pointerStart=null;setTimeout(()=>suppressClick=false,0)});
      block.addEventListener("click", async (event) => {
        if (event.target !== image || suppressClick) return;
        const bounds = image.getBoundingClientRect();
        const u = (event.clientX - bounds.left) / Math.max(1, bounds.width);
        const v = (event.clientY - bounds.top) / Math.max(1, bounds.height);
        let marker=block.querySelector(".species-region-selection");if(!marker){marker=document.createElement("span");marker.className="species-region-selection";marker.style.cssText="position:absolute;width:20px;height:20px;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(255,169,46,.7);pointer-events:none;transform:translate(-50%,-50%);z-index:2";block.append(marker);}marker.style.left=(u*100)+"%";marker.style.top=(v*image.clientHeight)+"px";
        let panel = block.querySelector(".species-region-results");
        if (!panel) { panel = document.createElement("section"); panel.className = "species-region-results"; block.append(panel); }
        panel.textContent = "Loading regional photos and sounds…";
        try {
          const region = await speciesRegionRecords(source, u, v);
          panel.replaceChildren();
          const title = document.createElement("strong"); title.textContent = region.name + " · " + region.count.toLocaleString() + " records"; panel.append(title);
          const gallery = document.createElement("div"); gallery.className = "species-region-gallery";
          for (const photo of region.photos) { const link=document.createElement("a"); link.href=photo.reference||photo.url; link.target="_blank"; const img=document.createElement("img"); img.src=photo.url; img.loading="lazy"; img.alt=photo.creator||region.taxon.scientificName; link.append(img); gallery.append(link); }
          panel.append(gallery);
          for (const sound of region.sounds) { const row=document.createElement("div"); row.className="species-region-sound"; const label=document.createElement("span"); label.textContent=sound.creator||sound.place||"GBIF recording"; const audio=document.createElement("audio"); audio.controls=true; audio.preload="none"; audio.src=sound.url; row.append(label,audio); panel.append(row); }
          if (!region.photos.length && !region.sounds.length) panel.append("No media found in this region.");
        } catch (error) { panel.textContent = "Regional records unavailable: " + error.message; }
      });
    } catch (error) {
      block.textContent = `Species map unavailable: ${error.message}`;
      console.warn("Species map rendering failed.", error);
    }
  }));
}
