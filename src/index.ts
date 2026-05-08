#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchUrl } from "./fetch.js";
import { fetchByCursor, ingest, type ChunkOutput } from "./chunker.js";

const DEFAULT_CHUNK_SIZE = 80_000;
const MAX_CHUNK_SIZE = 200_000;

const server = new McpServer(
  { name: "mcp-genshijin-fetch", version: "0.1.0" },
  {
    instructions:
      "Fetches URLs and returns the full markdown content with no Haiku summarization. " +
      "Long pages are split with cursor-based pagination — call fetch_chunk with the returned next_cursor to read the rest. " +
      "All metadata (total_chars, total_chunks, has_next) is exposed so truncation is never silent.",
  },
);

const fetchInputSchema = z.object({
  url: z.string().url().describe("URL to fetch (http or https)"),
  extract_main: z
    .boolean()
    .default(true)
    .describe(
      "Extract main article content via Mozilla Readability before converting HTML→Markdown. Set false to keep the entire body markup.",
    ),
  chunk_size: z
    .number()
    .int()
    .positive()
    .max(MAX_CHUNK_SIZE)
    .default(DEFAULT_CHUNK_SIZE)
    .describe(
      `Soft limit on characters per chunk (default ${DEFAULT_CHUNK_SIZE}). Splits prefer heading and paragraph boundaries.`,
    ),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .default(30_000)
    .describe("Network timeout in milliseconds"),
});

server.registerTool(
  "fetch",
  {
    title: "Fetch URL as Markdown",
    description:
      "Fetch a URL and return its full content as markdown. Honest replacement for Claude Code WebFetch: no Haiku summarization, no silent truncation. Long pages return the first chunk plus next_cursor for pagination via fetch_chunk.",
    inputSchema: fetchInputSchema,
  },
  async ({ url, extract_main, chunk_size, timeout_ms }) => {
    const page = await fetchUrl(url, {
      extractMain: extract_main,
      timeoutMs: timeout_ms,
    });
    const out = ingest({
      url: page.url,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      extractedMain: page.extractedMain,
      text: page.markdown,
      chunkSize: chunk_size,
    });
    return toToolResult(out);
  },
);

const fetchChunkInputSchema = z.object({
  cursor: z.string().min(1).describe("next_cursor from a prior fetch/fetch_chunk call"),
});

server.registerTool(
  "fetch_chunk",
  {
    title: "Fetch next chunk",
    description:
      "Return the next chunk of a previously fetched URL. Pass the next_cursor returned by fetch (or a prior fetch_chunk). Cursors are single-use and expire after 30 minutes.",
    inputSchema: fetchChunkInputSchema,
  },
  async ({ cursor }) => {
    const out = fetchByCursor(cursor);
    return toToolResult(out);
  },
);

function toToolResult(out: ChunkOutput) {
  const header = formatMetaHeader(out);
  return {
    content: [{ type: "text" as const, text: `${header}\n\n${out.content}` }],
  };
}

function formatMetaHeader(out: ChunkOutput): string {
  const m = out.meta;
  const lines = [
    `<!-- mcp-genshijin-fetch meta`,
    `source: ${m.source_url}`,
    m.final_url !== m.source_url ? `final: ${m.final_url}` : null,
    `content-type: ${m.content_type || "(unknown)"}`,
    `chunk: ${m.chunk_index + 1}/${m.total_chunks} (${m.chunk_chars} chars of ${m.total_chars} total)`,
    `extracted_main: ${m.extracted_main}`,
    m.has_next
      ? `has_next: true — call fetch_chunk with cursor "${m.next_cursor}"`
      : `has_next: false (final chunk)`,
    `-->`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("mcp-genshijin-fetch running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
