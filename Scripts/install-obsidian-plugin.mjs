#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(scriptsDir);
const pluginSource = path.join(workspace, "obsidian-ar-plugin");
const vaultIndex = process.argv.indexOf("--vault");
let vaultPath = vaultIndex >= 0 ? process.argv[vaultIndex + 1] : "";
const configPath = path.join(workspace, "note-bridge.config.json");
if (!vaultPath && existsSync(configPath)) {
  vaultPath = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "")).vaultPath ?? "";
}
if (!vaultPath || !path.isAbsolute(vaultPath) || !existsSync(vaultPath)) {
  console.error("Uso: node Scripts/install-obsidian-plugin.mjs --vault /caminho/absoluto/do/vault");
  process.exit(1);
}
if (!existsSync(path.join(pluginSource, "node_modules"))) {
  const install = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--prefix", pluginSource], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--prefix", pluginSource], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const target = path.join(path.resolve(vaultPath), ".obsidian", "plugins", "meta-quest-sync");
mkdirSync(target, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) cpSync(path.join(pluginSource, name), path.join(target, name));
console.log(`Plugin instalado em ${target}`);
