import { getAllTags, type App, type TFile } from "obsidian";

export interface ExportedGraph {
  generatedAt: string;
  nodes: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    z: number;
    color: string;
    val: number;
  }>;
  links: Array<{ source: string; target: string }>;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function folderColor(path: string): string {
  const folder = path.includes("/") ? path.slice(0, path.indexOf("/")) : "root";
  const hue = hashText(folder) % 360;
  return `hsl(${hue}, 72%, 64%)`;
}

function initialPosition(path: string): [number, number, number] {
  const hash = hashText(path);
  const azimuth = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const vertical = (((hash >>> 16) & 0xffff) / 0xffff) * 2 - 1;
  const radius = 12 + ((hash >>> 8) & 7);
  const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  return [
    Math.cos(azimuth) * horizontal * radius,
    vertical * radius,
    Math.sin(azimuth) * horizontal * radius
  ];
}

function isExcluded(file: TFile, folders: string[], tags: string[], app: App): boolean {
  const normalized = file.path.toLocaleLowerCase();
  if (folders.some((folder) => {
    const candidate = folder.toLocaleLowerCase();
    return normalized === candidate || normalized.startsWith(`${candidate}/`);
  })) return true;
  const cache = app.metadataCache.getFileCache(file);
  const fileTags = new Set(
    (cache ? getAllTags(cache) ?? [] : []).map((tag) => tag.toLocaleLowerCase())
  );
  return tags.some((tag) => fileTags.has(tag.toLocaleLowerCase()));
}

export function exportVaultGraph(app: App, excludedFolders: string[], excludedTags: string[]): ExportedGraph {
  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => !isExcluded(file, excludedFolders, excludedTags, app));
  const paths = new Set(files.map((file) => file.path));
  const degree = new Map<string, number>(files.map((file) => [file.path, 0]));
  const links: ExportedGraph["links"] = [];
  const seen = new Set<string>();
  for (const source of files) {
    const targets = app.metadataCache.resolvedLinks[source.path] ?? {};
    for (const target of Object.keys(targets)) {
      if (!paths.has(target)) continue;
      const key = source.path < target ? `${source.path}\n${target}` : `${target}\n${source.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: source.path, target });
      degree.set(source.path, (degree.get(source.path) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  const nodes = files.map((file) => {
    const [x, y, z] = initialPosition(file.path);
    return {
      id: file.path,
      label: file.basename,
      x,
      y,
      z,
      color: folderColor(file.path),
      val: Math.max(1, degree.get(file.path) ?? 0)
    };
  });
  return { generatedAt: new Date().toISOString(), nodes, links };
}
