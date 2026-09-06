import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMermaidSource } from "../public/mermaid-source.js";

test("converts Obsidian wikilinks inside Mermaid labels to display text", () => {
  const source = 'A["<b>[[Bem-te-vi]]</b>"] --> B["[[Bird#Taxonomy|Taxonomy]]"]';
  assert.equal(normalizeMermaidSource(source), 'A["Bem-te-vi"] --> B["Taxonomy"]');
});

test("normalizes HTML line breaks and emphasis in strict Mermaid labels",()=>{
 assert.equal(normalizeMermaidSource('A["Bird<br><i>(Name)</i>"]'),'A["Bird · (Name)"]');
});
