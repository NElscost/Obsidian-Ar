// Mermaid brackets have meaning of their own, so Obsidian wikilinks inside
// labels must become display text before parsing the diagram.
export function normalizeMermaidSource(source) {
  return String(source ?? "")
    .replace(/!?\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
      (_whole, target, alias) => String(alias || target).split("#").at(-1).trim())
    // Mermaid's strict SVG renderer is more reliable on Quest with native text.
    .replace(/<br\s*\/?s*>/gi, " · ")
    .replace(/<\/?(?:b|i|em|strong)\s*>/gi, "");
}
