const rasterCache = new Map();

function linesOf(source) {
  return String(source ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function remember(key, value) {
  rasterCache.delete(key);
  rasterCache.set(key, value);
  while (rasterCache.size > 12) rasterCache.delete(rasterCache.keys().next().value);
  return value;
}

function roundRect(context, x, y, width, height, radius, fill, stroke) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.stroke(); }
}

function lollipop(source) {
  const rows = linesOf(source).slice(1);
  const gene = rows.find((line) => /^gene\s+/i.test(line))?.replace(/^gene\s+/i, "") || "Gene";
  const length = Math.max(1, Number(rows.find((line) => /^length\s+/i.test(line))?.split(/\s+/)[1]) || 100);
  const domains = rows.map((line) => line.match(/^domain\s+(\d+)\s+(\d+)\s+(.+)$/i)).filter(Boolean);
  const variants = rows.map((line) => line.match(/^variant\s+(\S+)\s+(\d+)\s+(.+)$/i)).filter(Boolean);
  const width = 920, height = Math.max(330, 235 + Math.ceil(variants.length / 10) * 32);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const c = canvas.getContext("2d", { alpha: true });
  c.font = "700 30px system-ui"; c.fillStyle = "#eef5ff"; c.textAlign = "center"; c.fillText(gene, width / 2, 42);
  const left = 65, right = width - 65, axisY = 185, span = right - left;
  c.strokeStyle = "#8da8d2"; c.lineWidth = 7; c.beginPath(); c.moveTo(left, axisY); c.lineTo(right, axisY); c.stroke();
  const palette = ["#20c997", "#6ea8fe", "#b197fc", "#ff922b", "#f06595"];
  domains.forEach((match, index) => {
    const x1 = left + (Number(match[1]) - 1) / length * span, x2 = left + Number(match[2]) / length * span;
    roundRect(c, x1, axisY - 18, Math.max(8, x2 - x1), 36, 10, palette[index % palette.length]);
    c.font = "700 17px system-ui"; c.fillStyle = "#eef5ff"; c.textAlign = "center"; c.fillText(match[3], (x1 + x2) / 2, axisY + 52);
  });
  const levels = new Map();
  variants.forEach((match, index) => {
    const position = Number(match[2]), bucket = Math.round(position / Math.max(1, length / 25));
    const level = levels.get(bucket) || 0; levels.set(bucket, level + 1);
    const x = left + position / length * span, y = axisY - 42 - level * 42;
    const color = /frameshift/i.test(match[3]) ? "#ff922b" : /nonsense/i.test(match[3]) ? "#ff5d73" : "#70d6ff";
    c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.moveTo(x, axisY - 18); c.lineTo(x, y); c.stroke();
    c.fillStyle = color; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(x + 5, y - 12); c.rotate(-Math.PI / 4); c.font = "700 15px system-ui"; c.fillStyle = "#eef5ff"; c.textAlign = "left"; c.fillText(match[1], 0, 0); c.restore();
  });
  c.font = "16px system-ui"; c.fillStyle = "#a9bad4"; c.textAlign = "left"; c.fillText("1", left, axisY + 82); c.textAlign = "right"; c.fillText(String(length), right, axisY + 82);
  return canvas;
}

function pedigree(source) {
  const rows = linesOf(source).slice(1), nodes = new Map(), couples = [];
  for (const line of rows) {
    const node = line.match(/^node\s+(\S+)\s+(male|female)\s+(affected|unaffected|unknown)\s+(carrier|noncarrier|unknown)(?:\s+(\S+))?$/i);
    if (node) nodes.set(node[1], { id: node[1], sex: node[2].toLowerCase(), status: node[3].toLowerCase(), carrier: node[4].toLowerCase(), parents: node[5] || "" });
    const couple = line.match(/^couple\s+(\S+)\s+(\S+)$/i); if (couple) couples.push([couple[1], couple[2]]);
  }
  const generations = new Map();
  function generation(node, stack = new Set()) {
    if (!node?.parents || stack.has(node.id)) return 0;
    stack.add(node.id); const parentIds = node.parents.split("-");
    return 1 + Math.max(...parentIds.map((id) => generation(nodes.get(id), stack)), 0);
  }
  for (const node of nodes.values()) { const level = generation(node); if (!generations.has(level)) generations.set(level, []); generations.get(level).push(node); }
  const width = 920, height = Math.max(330, 115 + generations.size * 150), canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const c = canvas.getContext("2d", { alpha: true }), positions = new Map();
  for (const [level, items] of [...generations.entries()].sort((a,b) => a[0]-b[0])) items.forEach((node, index) => positions.set(node.id, { x: width * (index + 1) / (items.length + 1), y: 75 + level * 145 }));
  c.strokeStyle = "#91a9c9"; c.lineWidth = 4;
  for (const node of nodes.values()) if (node.parents) {
    const child = positions.get(node.id), parents = node.parents.split("-").map((id) => positions.get(id)).filter(Boolean);
    if (child && parents.length) { const px = parents.reduce((sum,p)=>sum+p.x,0)/parents.length, py = Math.max(...parents.map(p=>p.y))+30; c.beginPath(); c.moveTo(px,py); c.lineTo(px,child.y-35); c.lineTo(child.x,child.y-35); c.stroke(); }
  }
  for (const [a,b] of couples) { const pa=positions.get(a),pb=positions.get(b); if(pa&&pb){c.beginPath();c.moveTo(pa.x,pa.y);c.lineTo(pb.x,pb.y);c.stroke();} }
  for (const node of nodes.values()) {
    const p=positions.get(node.id), fill=node.status==="affected"?"#ff5d73":node.status==="unknown"?"#6c7c91":"#14243b";
    c.fillStyle=fill;c.strokeStyle=node.carrier==="carrier"?"#ffd166":"#dce9ff";c.lineWidth=node.carrier==="carrier"?7:4;c.beginPath();
    if(node.sex==="female") c.arc(p.x,p.y,27,0,Math.PI*2); else c.rect(p.x-25,p.y-25,50,50); c.fill();c.stroke();
    c.font="700 17px system-ui";c.fillStyle="#eef5ff";c.textAlign="center";c.fillText(node.id,p.x,p.y+52);
  }
  return canvas;
}

function rasterize(source) {
  const cached = rasterCache.get(source); if (cached) return cached;
  const mode = linesOf(source)[0]?.toLowerCase();
  const canvas = mode === "lollipopdiagram" ? lollipop(source) : mode === "pedigreediagram" ? pedigree(source) : null;
  if (!canvas) throw new Error("Unsupported gene-code diagram.");
  return remember(source, { src: canvas.toDataURL("image/webp", .86), width: canvas.width, height: canvas.height });
}

export function createGeneCodeExtension() {
  async function renderBlocks(root) {
    for (const element of root.querySelectorAll("[data-note-gene-code]")) {
      let source = element.dataset.noteGeneCode || ""; try { source = decodeURIComponent(source); } catch {}
      try { const raster = rasterize(source), image = new Image(); image.className = "note-gene-code-image"; image.alt = "Gene diagram"; image.decoding = "async"; image.src = raster.src; image.width = raster.width; image.height = raster.height; element.replaceChildren(image); }
      catch (error) { element.textContent = `Gene-code: ${error.message}`; }
    }
  }
  return { renderBlocks };
}
