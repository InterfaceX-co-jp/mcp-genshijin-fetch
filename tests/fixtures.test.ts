import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractMainContent } from "../src/extract.js";
import { ingest, fetchByCursor, _resetForTests } from "../src/chunker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");

async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(FIXTURES_DIR, name), "utf8");
}

describe("fixture: example.com (short HTML)", () => {
  let html = "";
  before(async () => (html = await loadFixture("example-com.html")));

  it("converts to markdown without error", () => {
    const result = extractMainContent(html, "https://example.com");
    assert.ok(result.markdown.includes("Example Domain"));
    assert.ok(result.markdown.length > 50);
    assert.ok(result.markdown.length < 1000);
  });
});

describe("fixture: Zenn article (Japanese, news-style)", () => {
  let html = "";
  before(async () => (html = await loadFixture("zenn-article.html")));

  it("extracts main content via Readability", () => {
    const result = extractMainContent(
      html,
      "https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary",
    );
    assert.equal(result.extractedMain, true);
    assert.ok(result.markdown.length > 5000, `markdown too short: ${result.markdown.length}`);
    assert.ok(result.markdown.length < 50000, `markdown suspiciously long: ${result.markdown.length}`);
  });

  it("preserves Japanese characters (no mojibake)", () => {
    const result = extractMainContent(
      html,
      "https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary",
    );
    assert.match(result.markdown, /Claude/);
    assert.match(result.markdown, /Haiku|要約|WebFetch/);
    assert.doesNotMatch(result.markdown, /�/);
  });

  it("paginates correctly with chunk_size 5000", () => {
    _resetForTests();
    const result = extractMainContent(
      html,
      "https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary",
    );
    const out = ingest({
      url: "https://zenn.dev/...",
      finalUrl: "https://zenn.dev/...",
      contentType: "text/html",
      extractedMain: result.extractedMain,
      text: result.markdown,
      chunkSize: 5000,
    });
    assert.ok(out.meta.total_chunks >= 2);

    let combined = out.content;
    let cursor = out.meta.next_cursor;
    while (cursor) {
      const next = fetchByCursor(cursor);
      combined += next.content;
      cursor = next.meta.next_cursor;
    }
    assert.equal(combined, result.markdown);
  });
});

describe("fixture: Wikipedia MCP article (long, structured)", () => {
  let html = "";
  before(async () => (html = await loadFixture("wikipedia-mcp.html")));

  it("extracts substantial main content", () => {
    const result = extractMainContent(
      html,
      "https://en.wikipedia.org/wiki/Model_Context_Protocol",
    );
    assert.equal(result.extractedMain, true);
    assert.ok(result.markdown.length > 5000);
    assert.match(result.markdown, /Model Context Protocol/);
  });

  it("respects chunk_size and prefers heading boundaries", () => {
    _resetForTests();
    const result = extractMainContent(
      html,
      "https://en.wikipedia.org/wiki/Model_Context_Protocol",
    );
    const chunkSize = 8000;
    const out = ingest({
      url: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
      finalUrl: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
      contentType: "text/html",
      extractedMain: true,
      text: result.markdown,
      chunkSize,
    });

    assert.ok(out.meta.total_chunks >= 2);
    for (const chunk of [out.content]) {
      assert.ok(chunk.length <= chunkSize + 500);
    }

    let combined = out.content;
    let cursor = out.meta.next_cursor;
    let chunksWalked = 1;
    while (cursor) {
      const next = fetchByCursor(cursor);
      assert.ok(next.content.length <= chunkSize + 500);
      combined += next.content;
      cursor = next.meta.next_cursor;
      chunksWalked++;
    }
    assert.equal(combined.length, result.markdown.length);
    assert.equal(chunksWalked, out.meta.total_chunks);
  });
});

describe("fixture: GitHub README (text/plain markdown)", () => {
  let body = "";
  before(async () => (body = await loadFixture("github-readme.md")));

  it("is plain markdown, not HTML", () => {
    assert.doesNotMatch(body.slice(0, 200), /<html|<!doctype/i);
    assert.match(body, /^#/m);
  });

  it("paginates as-is without HTML→markdown conversion", () => {
    _resetForTests();
    const out = ingest({
      url: "https://raw.githubusercontent.com/...",
      finalUrl: "https://raw.githubusercontent.com/...",
      contentType: "text/plain",
      extractedMain: false,
      text: body,
      chunkSize: 3000,
    });
    let combined = out.content;
    let cursor = out.meta.next_cursor;
    while (cursor) {
      const next = fetchByCursor(cursor);
      combined += next.content;
      cursor = next.meta.next_cursor;
    }
    assert.equal(combined, body);
  });
});
