/**
 * Execute no DevTools do Obsidian.
 * Exporta o layout do plugin 3D Graph New para um graph.json compatível
 * com o gerador Blender: { nodes, links }.
 */
(async () => {
  const PLUGIN_ID = "3d-graph-new";
  const SCALE_CONTROL = 25;

  const plugin = window.app?.plugins?.plugins?.[PLUGIN_ID];
  const rawLinks =
    plugin?.fileManager?.searchEngine?.plugin?.globalGraph?.links;

  if (!Array.isArray(rawLinks)) {
    throw new Error(
      `Plugin "${PLUGIN_ID}" indisponível ou grafo ainda não carregado. ` +
      "Abra a visualização 3D do grafo e execute novamente."
    );
  }

  const nodesMap = new Map();
  const linksMap = new Map();
  const degreeMap = new Map();

  const finiteCoordinate = (value) =>
    Number.isFinite(Number(value)) ? Number(value) / SCALE_CONTROL : 0;

  const normalizePath = (value) =>
    String(value ?? "").replaceAll("\\", "/").trim();

  const groupFromPath = (path) => {
    const parts = path.split("/");
    return parts.length > 1 ? parts[0] : "(raiz)";
  };

  const hashString = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const hslToHex = (hue, saturation = 72, lightness = 58) => {
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const sector = hue / 60;
    const x = chroma * (1 - Math.abs((sector % 2) - 1));
    const [r1, g1, b1] =
      sector < 1 ? [chroma, x, 0] :
      sector < 2 ? [x, chroma, 0] :
      sector < 3 ? [0, chroma, x] :
      sector < 4 ? [0, x, chroma] :
      sector < 5 ? [x, 0, chroma] :
                   [chroma, 0, x];
    const offset = l - chroma / 2;
    const channel = (value) =>
      Math.round((value + offset) * 255).toString(16).padStart(2, "0");
    return `#${channel(r1)}${channel(g1)}${channel(b1)}`;
  };

  const colorForGroup = (group) =>
    hslToHex(hashString(group) % 360);

  const addNode = (rawNode) => {
    const path = normalizePath(rawNode?.path);
    if (!path.toLowerCase().endsWith(".md") || nodesMap.has(path)) return path;

    const group = groupFromPath(path);
    nodesMap.set(path, {
      id: path,
      label: path.replace(/\.md$/i, ""),
      x: finiteCoordinate(rawNode?.x),
      y: finiteCoordinate(rawNode?.y),
      z: finiteCoordinate(rawNode?.z),
      group,
      color: colorForGroup(group),
      degree: 0
    });
    return path;
  };

  for (const rawLink of rawLinks) {
    const source = addNode(rawLink?.source);
    const target = addNode(rawLink?.target);

    if (
      !source?.toLowerCase().endsWith(".md") ||
      !target?.toLowerCase().endsWith(".md") ||
      source === target
    ) continue;

    const [first, second] = [source, target].sort();
    const linkKey = `${first}\u0000${second}`;
    if (linksMap.has(linkKey)) continue;

    linksMap.set(linkKey, { source, target });
    degreeMap.set(source, (degreeMap.get(source) ?? 0) + 1);
    degreeMap.set(target, (degreeMap.get(target) ?? 0) + 1);
  }

  const nodes = Array.from(nodesMap.values()).map((node) => ({
    ...node,
    degree: degreeMap.get(node.id) ?? 0
  }));
  const links = Array.from(linksMap.values());
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      source: "Obsidian 3D Graph New",
      scaleControl: SCALE_CONTROL,
      colorStrategy: "top-level-folder"
    },
    nodes,
    links
  };

  const json = JSON.stringify(output, null, 2);
  const automationPath = ".obsidian/space-ar-graph.json";
  await window.app.vault.adapter.write(automationPath, json);
  console.log(`Graph exportado: ${nodes.length} nós, ${links.length} links.`);
  console.log(`JSON salvo para automação em ${automationPath}.`);

  if (typeof copy === "function") {
    copy(json);
    console.log("JSON copiado para a área de transferência.");
  } else {
    navigator.clipboard.writeText(json)
      .then(() => console.log("JSON copiado para a área de transferência."))
      .catch(() => console.warn("Não foi possível copiar automaticamente.", json));
  }

  return `Graph exportado: ${nodes.length} nós, ${links.length} links.`;
})();
