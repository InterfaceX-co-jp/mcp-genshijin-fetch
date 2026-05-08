#!/usr/bin/env node
// Capture HTML/markdown fixtures from real URLs for offline integration tests.
// Run manually when fixtures need refreshing:
//   node tests/integration/capture-fixtures.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

const TARGETS = [
  {
    name: "example-com.html",
    url: "https://example.com",
    contentType: "text/html",
  },
  {
    name: "zenn-article.html",
    url: "https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary",
    contentType: "text/html",
  },
  {
    name: "wikipedia-mcp.html",
    url: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
    contentType: "text/html",
  },
  {
    name: "github-readme.md",
    url: "https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md",
    contentType: "text/plain",
  },
];

async function main() {
  for (const t of TARGETS) {
    process.stderr.write(`fetching ${t.url} ... `);
    const res = await fetch(t.url, {
      headers: { "User-Agent": "mcp-genshijin-fetch fixture capture/0.1" },
    });
    const body = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    const meta = {
      url: t.url,
      finalUrl: res.url,
      status: res.status,
      contentType: ct,
      capturedAt: new Date().toISOString(),
      bytes: body.length,
    };
    const out = resolve(FIXTURES_DIR, t.name);
    await writeFile(out, body, "utf8");
    await writeFile(`${out}.meta.json`, JSON.stringify(meta, null, 2), "utf8");
    process.stderr.write(`${body.length} bytes → ${out}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
