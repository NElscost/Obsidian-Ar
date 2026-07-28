import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const [url, token, graphPath, requestCount = "200", concurrency = "25"] =
  process.argv.slice(2);

if (!url || !token || !graphPath) {
  throw new Error(
    "Uso: node stress-test.mjs <url> <token> <graph.json> [pedidos] [concorrência]"
  );
}

const graph = JSON.parse(await readFile(graphPath, "utf8"));
const paths = graph.nodes
  .map((node) => String(node.id ?? "").replaceAll("\\", "/"))
  .filter((path) => path.toLowerCase().endsWith(".md"));

const total = Number(requestCount);
const workers = Math.min(Number(concurrency), total);
const latencies = [];
let next = 0;
let ok = 0;
let errors = 0;
let bytes = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const path = paths[index % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(`${url}/note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept-Encoding": "br, gzip"
        },
        body: JSON.stringify({ path })
      });
      const body = await response.text();
      latencies.push(performance.now() - started);
      bytes += Buffer.byteLength(body);
      if (response.ok) ok += 1;
      else errors += 1;
    } catch {
      latencies.push(performance.now() - started);
      errors += 1;
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: workers }, worker));
const elapsed = performance.now() - started;
latencies.sort((a, b) => a - b);
const percentile = (fraction) =>
  latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))];

console.log(JSON.stringify({
  requests: total,
  concurrency: workers,
  ok,
  errors,
  transferredResponseBytes: bytes,
  elapsedMs: Number(elapsed.toFixed(1)),
  requestsPerSecond: Number((total / (elapsed / 1000)).toFixed(1)),
  latencyMs: {
    p50: Number(percentile(0.50).toFixed(1)),
    p95: Number(percentile(0.95).toFixed(1)),
    p99: Number(percentile(0.99).toFixed(1)),
    max: Number(latencies.at(-1).toFixed(1))
  }
}, null, 2));
