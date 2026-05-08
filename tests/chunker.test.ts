import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ingest, fetchByCursor, _resetForTests } from "../src/chunker.js";

beforeEach(() => _resetForTests());

describe("chunker", () => {
  it("returns single chunk when text fits chunk size", () => {
    const text = "short body";
    const out = ingest({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      extractedMain: true,
      text,
      chunkSize: 1000,
    });
    assert.equal(out.content, text);
    assert.equal(out.meta.has_next, false);
    assert.equal(out.meta.next_cursor, null);
    assert.equal(out.meta.total_chunks, 1);
    assert.equal(out.meta.chunk_index, 0);
  });

  it("splits long text and exposes cursor for next chunk", () => {
    const text = "A".repeat(5000) + "\n\n" + "B".repeat(5000);
    const out = ingest({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      extractedMain: true,
      text,
      chunkSize: 5000,
    });
    assert.equal(out.meta.has_next, true);
    assert.ok(out.meta.next_cursor);
    assert.ok(out.meta.total_chunks >= 2);
    assert.equal(out.meta.chunk_index, 0);
  });

  it("walks all chunks via fetch_chunk and reconstructs the text", () => {
    const sections = Array.from({ length: 6 }, (_, i) => `## Section ${i}\n${"x".repeat(900)}`);
    const text = sections.join("\n\n");
    const first = ingest({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      extractedMain: true,
      text,
      chunkSize: 2000,
    });
    let combined = first.content;
    let cursor = first.meta.next_cursor;
    let lastSeenIndex = 0;
    while (cursor) {
      const next = fetchByCursor(cursor);
      combined += next.content;
      assert.equal(next.meta.chunk_index, lastSeenIndex + 1);
      lastSeenIndex = next.meta.chunk_index;
      cursor = next.meta.next_cursor;
    }
    assert.equal(combined, text);
    assert.equal(lastSeenIndex + 1, first.meta.total_chunks);
  });

  it("rejects unknown cursors", () => {
    assert.throws(() => fetchByCursor("not-a-real-cursor"), /Unknown or expired cursor/);
  });

  it("invalidates cursor after use (single-use)", () => {
    const text = "AAA".repeat(2000) + "\n\n" + "BBB".repeat(2000);
    const first = ingest({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      extractedMain: true,
      text,
      chunkSize: 3000,
    });
    const cursor = first.meta.next_cursor!;
    fetchByCursor(cursor);
    assert.throws(() => fetchByCursor(cursor), /Unknown or expired cursor/);
  });
});
