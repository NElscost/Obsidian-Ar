export function createFastaExtension(THREE, api) {
  const COLORS = {
    hydrophobic: "#63e6be", polar: "#74c0fc", acidic: "#ff8787",
    basic: "#b197fc", special: "#ffd166", gap: "#36445a", unknown: "#74839a"
  };
  const cache = new Map();
  let group = null, surface = null, texture = null, state = null, controls = [];

  function residueGroup(value) {
    if ("AVILMFWY".includes(value)) return "hydrophobic";
    if ("STNQ".includes(value)) return "polar";
    if ("DE".includes(value)) return "acidic";
    if ("KRH".includes(value)) return "basic";
    if ("CGP".includes(value)) return "special";
    if (value === "-" || value === ".") return "gap";
    return "unknown";
  }

  function parse(source) {
    const text = String(source ?? "").slice(0, 500_000);
    const sequences = [];
    let current = null;
    for (const original of text.split(/\r?\n/)) {
      const line = original.trim();
      if (!line || line.startsWith(";")) continue;
      if (line.startsWith(">")) {
        if (current) sequences.push(current);
        const title = line.slice(1).trim() || `Sequence ${sequences.length + 1}`;
        current = { id: title.split(/\s+/)[0], title, sequence: "" };
      } else {
        current ??= { id: "Sequence_1", title: "Sequence 1", sequence: "" };
        current.sequence += (line.toUpperCase().match(/[A-Z*.-]/g) || []).join("");
      }
      if (sequences.length >= 127) break;
    }
    if (current && sequences.length < 128) sequences.push(current);
    const valid = sequences.filter((item) => item.sequence.length > 0);
    if (!valid.length) throw new Error("No valid FASTA sequences found.");
    const length = Math.max(...valid.map((item) => item.sequence.length));
    for (const item of valid) item.sequence = item.sequence.padEnd(length, "-");
    const consensus = [], conservation = [];
    for (let column = 0; column < length; column += 1) {
      const counts = new Map();
      for (const item of valid) {
        const residue = item.sequence[column];
        if (residue !== "-" && residue !== ".") counts.set(residue, (counts.get(residue) || 0) + 1);
      }
      const winner = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      consensus.push(winner?.[0] || "-");
      conservation.push((winner?.[1] || 0) / valid.length);
    }
    return { sequences: valid, length, consensus: consensus.join(""), conservation };
  }

  function clipped(ctx, text, width) {
    let result = String(text ?? "");
    if (ctx.measureText(result).width <= width) return result;
    while (result.length > 2 && ctx.measureText(result + "…").width > width) result = result.slice(0, -1);
    return result + "…";
  }

  function draw(canvas, model, view = {}) {
    const ctx = canvas.getContext("2d", { alpha: true });
    const compact = Boolean(view.compact);
    const left = compact ? 145 : 210, top = compact ? 42 : 72;
    const columns = compact ? Math.min(54, model.length) : Math.min(42, model.length - (view.column || 0));
    const rows = compact ? Math.min(6, model.sequences.length) : Math.min(9, model.sequences.length - (view.row || 0));
    const columnStart = compact ? 0 : view.column || 0, rowStart = compact ? 0 : view.row || 0;
    const cellWidth = (canvas.width - left - 18) / Math.max(1, columns);
    const rowHeight = compact ? 25 : 36;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = compact ? "rgba(7,17,31,.82)" : "rgba(7,17,31,.9)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f3f7ff"; ctx.textAlign = "center";
    ctx.font = compact ? "700 18px system-ui" : "700 25px system-ui";
    ctx.fillText(`FASTA · ${model.sequences.length} sequences · ${model.length} residues`, canvas.width / 2, compact ? 25 : 32);
    ctx.font = compact ? "600 11px ui-monospace" : "600 14px ui-monospace";
    for (let localRow = 0; localRow < rows; localRow += 1) {
      const sequenceIndex = rowStart + localRow, item = model.sequences[sequenceIndex];
      const y = top + localRow * rowHeight;
      ctx.fillStyle = sequenceIndex === (view.reference || 0) ? "#ffd166" : "#dce8f8";
      ctx.textAlign = "right";
      ctx.fillText(clipped(ctx, item.id, left - 18), left - 8, y + rowHeight * .68);
      for (let localColumn = 0; localColumn < columns; localColumn += 1) {
        const column = columnStart + localColumn, residue = item.sequence[column] || "-";
        const x = left + localColumn * cellWidth;
        ctx.fillStyle = COLORS[residueGroup(residue)];
        ctx.globalAlpha = residue === "-" ? .42 : .86;
        ctx.fillRect(x + .6, y + 2, Math.max(1, cellWidth - 1.2), rowHeight - 4);
        ctx.globalAlpha = 1;
        if (residue !== (model.sequences[view.reference || 0]?.sequence[column] || residue)) {
          ctx.strokeStyle = "#ffe066"; ctx.lineWidth = compact ? 1 : 1.5;
          ctx.strokeRect(x + 1.2, y + 2.5, Math.max(1, cellWidth - 2.4), rowHeight - 5);
        }
        ctx.fillStyle = "#07111f"; ctx.textAlign = "center";
        ctx.fillText(residue, x + cellWidth / 2, y + rowHeight * .68);
      }
    }
    const consensusY = top + rows * rowHeight + (compact ? 5 : 10);
    ctx.fillStyle = "#9fc2ff"; ctx.textAlign = "right";
    ctx.fillText("Consensus", left - 8, consensusY + rowHeight * .65);
    for (let localColumn = 0; localColumn < columns; localColumn += 1) {
      const column = columnStart + localColumn, x = left + localColumn * cellWidth;
      const residue = model.consensus[column] || "-", conservation = model.conservation[column] || 0;
      ctx.fillStyle = COLORS[residueGroup(residue)]; ctx.globalAlpha = .3 + conservation * .7;
      ctx.fillRect(x + .6, consensusY + 2, Math.max(1, cellWidth - 1.2), rowHeight - 4);
      ctx.globalAlpha = 1; ctx.fillStyle = "#07111f"; ctx.textAlign = "center";
      ctx.fillText(residue, x + cellWidth / 2, consensusY + rowHeight * .68);
      ctx.fillStyle = conservation > .8 ? "#63e6be" : conservation > .5 ? "#ffd166" : "#ff8787";
      ctx.fillRect(x + 1, consensusY + rowHeight - 4, Math.max(1, (cellWidth - 2) * conservation), 3);
    }
    if (!compact) {
      ctx.fillStyle = "#8fa5c2"; ctx.font = "13px system-ui"; ctx.textAlign = "left";
      ctx.fillText(`${columnStart + 1}–${columnStart + columns} · reference: ${model.sequences[view.reference || 0].id}`, left, canvas.height - 17);
      if (view.selected) {
        const selected = view.selected;
        ctx.fillStyle = "#f4f7ff"; ctx.textAlign = "right";
        ctx.fillText(`${selected.id} · ${selected.residue}${selected.column + 1} · conservation ${Math.round(selected.conservation * 100)}%`, canvas.width - 18, canvas.height - 17);
      }
    }
    return { left, top, columns, rows, columnStart, rowStart, cellWidth, rowHeight };
  }

  async function resolve(spec) {
    if (cache.has(spec)) return cache.get(spec);
    const raw = await api.fetchFasta(spec);
    const model = parse(raw);
    cache.set(spec, model);
    while (cache.size > 16) cache.delete(cache.keys().next().value);
    return model;
  }

  async function renderBlocks(root) {
    for (const element of root.querySelectorAll(".note-fasta")) {
      let spec = element.dataset.noteFasta || "";
      try { spec = decodeURIComponent(spec); } catch {}
      try {
        const model = await resolve(spec);
        const canvas = document.createElement("canvas"); canvas.width = 900;
        canvas.height = Math.min(280, 78 + Math.min(6, model.sequences.length) * 25);
        draw(canvas, model, { compact: true, reference: 0 });
        const image = new Image(); image.className = "note-fasta-image";
        image.alt = `FASTA alignment with ${model.sequences.length} sequences`;
        image.src = canvas.toDataURL("image/webp", .82);
        element.replaceChildren(image);
      } catch (error) {
        element.textContent = `FASTA could not be rendered: ${error.message}`;
      }
    }
  }

  function icon(label) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#07111f";
    ctx.font = "700 34px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, 32, 33);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = false; return map;
  }
  function addControl(action, x, label, color = 0x75a7ff) {
    const button = new THREE.Mesh(new THREE.CircleGeometry(.016, 14), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    button.position.set(x, -api.height / 2 + .025, .055); button.userData.noteAction = action; button.userData.highlightScale = false;
    const glyph = new THREE.Mesh(new THREE.PlaneGeometry(.022, .022), new THREE.MeshBasicMaterial({ map: icon(label), transparent: true, toneMapped: false }));
    glyph.position.z = .003; glyph.raycast = () => {}; button.add(glyph); group.add(button); controls.push(button); api.addControl(button);
  }
  function redraw() { if (!state || !texture) return; state.layout = draw(texture.image, state.model, state); texture.needsUpdate = true; }
  function dispose() {
    api.removeControls(new Set(controls)); api.unregister(group, false);
    if (group) { group.removeFromParent(); group.traverse((object) => { object.geometry?.dispose?.(); object.material?.map?.dispose?.(); object.material?.dispose?.(); }); }
    group = surface = texture = state = null; controls = []; api.layout();
  }
  async function open(spec) {
    dispose(); const model = await resolve(spec);
    state = { model, reference: 0, column: 0, row: 0, selected: null, layout: null };
    group = new THREE.Group(); group.name = "fasta-alignment-window";
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 512;
    texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    const geometry = api.geometry ? api.geometry(api.width, api.height, .018, 24) : new THREE.PlaneGeometry(api.width, api.height);
    surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: true, toneMapped: false }));
    surface.position.z = .012; surface.userData.noteAction = "fasta-grid"; surface.userData.highlightScale = false;
    group.add(surface); controls.push(surface); api.addControl(surface);
    addControl("fasta-columns-prev", -.09, "‹"); addControl("fasta-columns-next", -.054, "›");
    addControl("fasta-rows-prev", -.018, "↑"); addControl("fasta-rows-next", .018, "↓");
    addControl("fasta-reference", .054, "R", 0xffd166); addControl("fasta-close", api.width / 2 - .025, "×", 0xff6b6b);
    redraw(); api.register(group, api.width); api.message(`FASTA ready · ${model.sequences.length} sequences · ${model.length} residues.`);
  }
  function handle(action, options = {}) {
    if (!state) return false;
    if (action === "fasta-close") { dispose(); api.message("FASTA viewer closed."); return true; }
    if (action === "fasta-columns-prev") state.column = Math.max(0, state.column - 42);
    else if (action === "fasta-columns-next") state.column = Math.min(Math.max(0, state.model.length - 1), state.column + 42);
    else if (action === "fasta-rows-prev") state.row = Math.max(0, state.row - 9);
    else if (action === "fasta-rows-next") state.row = Math.min(Math.max(0, state.model.sequences.length - 1), state.row + 9);
    else if (action === "fasta-reference") { state.reference = (state.reference + 1) % state.model.sequences.length; state.selected = null; }
    else if (action === "fasta-grid") {
      const uv = options.uv, layout = state.layout;
      if (!uv || !layout) return true;
      const x = uv.x * 1024, y = (1 - uv.y) * 512;
      const localColumn = Math.floor((x - layout.left) / layout.cellWidth);
      const localRow = Math.floor((y - layout.top) / layout.rowHeight);
      if (localColumn >= 0 && localColumn < layout.columns && localRow >= 0 && localRow < layout.rows) {
        const column = layout.columnStart + localColumn, row = layout.rowStart + localRow, item = state.model.sequences[row];
        state.selected = { id: item.id, residue: item.sequence[column], column, conservation: state.model.conservation[column] || 0 };
        api.message(`${item.id} · ${item.sequence[column]}${column + 1} · ${Math.round((state.model.conservation[column] || 0) * 100)}% conserved.`);
      }
    } else return false;
    redraw(); return true;
  }
  return { parse, draw, renderBlocks, open, dispose, handle };
}
