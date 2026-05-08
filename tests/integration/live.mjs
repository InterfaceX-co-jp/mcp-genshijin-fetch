#!/usr/bin/env node
// Live integration test — hits real URLs. Not run in CI (flaky/slow).
// Run manually:  node tests/integration/live.mjs
// For offline reproducible tests, see tests/fixtures.test.ts (run via `npm test`).
// Requires: built dist/ (run `npm run build` first)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../dist/index.js");

const TARGETS = [
  {
    name: "example.com (short HTML)",
    url: "https://example.com",
    expect: { extractedMainAny: true, minTotalChars: 100 },
  },
  {
    name: "Zenn 元記事 (中程度長)",
    url: "https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary",
    expect: { extractedMain: true, minTotalChars: 2000 },
  },
  {
    name: "Wikipedia: Model Context Protocol (forced pagination)",
    url: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
    extra: { chunk_size: 8000 },
    expect: { extractedMain: true, minTotalChars: 5000, expectMultipleChunks: true },
  },
  {
    name: "raw.githubusercontent.com (text/plain markdown)",
    url:
      "https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md",
    expect: { extractedMain: false, minTotalChars: 1000 },
  },
];

class McpClient {
  constructor() {
    this.proc = spawn("node", [SERVER_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk) =>
      process.stderr.write(`[server] ${chunk}`),
    );
    this.proc.on("error", (e) => console.error("spawn error:", e));
  }
  onData(chunk) {
    this.buf += chunk.toString("utf8");
    let nl;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve: r, reject: rj } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rj(new Error(JSON.stringify(msg.error)));
        else r(msg.result);
      }
    }
  }
  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 60_000);
    });
  }
  notify(method, params) {
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }
  close() {
    this.proc.stdin.end();
    this.proc.kill("SIGTERM");
  }
}

function parseMeta(text) {
  const headerMatch = text.match(/^<!-- mcp-genshijin-fetch meta\n([\s\S]*?)\n-->/);
  if (!headerMatch) return null;
  const lines = headerMatch[1].split("\n");
  const meta = {};
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    meta[m[1].trim()] = m[2].trim();
  }
  const body = text.slice(headerMatch[0].length).trimStart();
  return { meta, body };
}

function extractCursor(metaLine) {
  const m = metaLine.match(/cursor "([^"]+)"/);
  return m ? m[1] : null;
}

async function runOne(client, target) {
  console.log(`\n=== ${target.name} ===`);
  console.log(`URL: ${target.url}`);
  const args = { url: target.url, ...(target.extra ?? {}) };
  const start = Date.now();
  let result;
  try {
    result = await client.send("tools/call", { name: "fetch", arguments: args });
  } catch (e) {
    console.log(`  ✗ fetch failed: ${e.message}`);
    return false;
  }
  const elapsed = Date.now() - start;
  const text = result?.content?.[0]?.text ?? "";
  const parsed = parseMeta(text);
  if (!parsed) {
    console.log("  ✗ meta header missing");
    return false;
  }
  const m = parsed.meta;
  console.log(`  status: ok in ${elapsed}ms`);
  console.log(`  content-type: ${m["content-type"]}`);
  console.log(`  extracted_main: ${m.extracted_main}`);
  console.log(`  chunk: ${m.chunk}`);
  console.log(`  body preview: ${parsed.body.slice(0, 120).replace(/\n/g, " ")}...`);

  // Walk all chunks if has_next
  let totalChars = parsed.body.length;
  let chunkCount = 1;
  let cursor = m.has_next?.includes("true") ? extractCursor(m.has_next) : null;
  while (cursor) {
    const r = await client.send("tools/call", {
      name: "fetch_chunk",
      arguments: { cursor },
    });
    const t = r?.content?.[0]?.text ?? "";
    const p = parseMeta(t);
    if (!p) break;
    totalChars += p.body.length;
    chunkCount++;
    cursor = p.meta.has_next?.includes("true") ? extractCursor(p.meta.has_next) : null;
  }
  console.log(`  chunks walked: ${chunkCount}, body bytes: ${totalChars}`);

  // Verify expectations
  const exp = target.expect ?? {};
  let pass = true;
  const totalCharsFromMeta = parseInt(m.chunk?.match(/of (\d+) total/)?.[1] ?? "0", 10);
  if (exp.minTotalChars && totalCharsFromMeta < exp.minTotalChars) {
    console.log(`  ✗ totalChars ${totalCharsFromMeta} < expected ${exp.minTotalChars}`);
    pass = false;
  }
  if (exp.extractedMain != null && String(exp.extractedMain) !== m.extracted_main) {
    console.log(`  ✗ extracted_main expected ${exp.extractedMain} got ${m.extracted_main}`);
    pass = false;
  }
  if (exp.expectMultipleChunks && chunkCount < 2) {
    console.log(`  ✗ expected multiple chunks but got ${chunkCount}`);
    pass = false;
  }
  console.log(pass ? "  ✓ all checks passed" : "  ✗ some checks failed");
  return pass;
}

async function main() {
  const client = new McpClient();
  await client.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1" },
  });
  client.notify("notifications/initialized", {});

  const tools = await client.send("tools/list", {});
  console.log(`tools/list: ${tools.tools.map((t) => t.name).join(", ")}`);

  const results = [];
  for (const t of TARGETS) {
    results.push({ name: t.name, pass: await runOne(client, t) });
  }
  console.log("\n=== Summary ===");
  let ok = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}`);
    if (r.pass) ok++;
  }
  console.log(`\n${ok}/${results.length} passed`);
  client.close();
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
