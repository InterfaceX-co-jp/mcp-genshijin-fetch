import { randomUUID } from "node:crypto";

export interface ChunkMeta {
  total_chars: number;
  total_chunks: number;
  chunk_index: number;
  chunk_chars: number;
  has_next: boolean;
  next_cursor: string | null;
  source_url: string;
  final_url: string;
  content_type: string;
  extracted_main: boolean;
  truncated: false;
}

interface StoredEntry {
  url: string;
  finalUrl: string;
  contentType: string;
  extractedMain: boolean;
  text: string;
  chunkSize: number;
  totalChunks: number;
  createdAt: number;
}

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 64;

const store = new Map<string, StoredEntry>();
const cursorIndex = new Map<string, { entryId: string; chunkIndex: number }>();

function reapExpired(now: number): void {
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(id);
    }
  }
  if (store.size > MAX_ENTRIES) {
    const sorted = [...store.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    while (store.size > MAX_ENTRIES) {
      const [id] = sorted.shift()!;
      store.delete(id);
    }
  }
  for (const [cursor, ref] of cursorIndex) {
    if (!store.has(ref.entryId)) cursorIndex.delete(cursor);
  }
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const tentativeEnd = Math.min(pos + chunkSize, text.length);
    if (tentativeEnd >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    const window = text.slice(pos, tentativeEnd);
    const breakPoint = findBreakPoint(window);
    const end = pos + breakPoint;
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

function findBreakPoint(window: string): number {
  const minBreak = Math.floor(window.length * 0.7);
  const candidates = [
    window.lastIndexOf("\n## "),
    window.lastIndexOf("\n# "),
    window.lastIndexOf("\n### "),
    window.lastIndexOf("\n\n"),
    window.lastIndexOf("\n"),
    window.lastIndexOf(". "),
  ];
  for (const idx of candidates) {
    if (idx >= minBreak) return idx + 1;
  }
  return window.length;
}

export interface IngestInput {
  url: string;
  finalUrl: string;
  contentType: string;
  extractedMain: boolean;
  text: string;
  chunkSize: number;
}

export interface ChunkOutput {
  content: string;
  meta: ChunkMeta;
}

export function ingest(input: IngestInput): ChunkOutput {
  const now = Date.now();
  reapExpired(now);

  const chunks = splitIntoChunks(input.text, input.chunkSize);
  const entryId = randomUUID();

  store.set(entryId, {
    url: input.url,
    finalUrl: input.finalUrl,
    contentType: input.contentType,
    extractedMain: input.extractedMain,
    text: input.text,
    chunkSize: input.chunkSize,
    totalChunks: chunks.length,
    createdAt: now,
  });

  let nextCursor: string | null = null;
  if (chunks.length > 1) {
    nextCursor = randomUUID();
    cursorIndex.set(nextCursor, { entryId, chunkIndex: 1 });
  }

  return {
    content: chunks[0]!,
    meta: {
      total_chars: input.text.length,
      total_chunks: chunks.length,
      chunk_index: 0,
      chunk_chars: chunks[0]!.length,
      has_next: chunks.length > 1,
      next_cursor: nextCursor,
      source_url: input.url,
      final_url: input.finalUrl,
      content_type: input.contentType,
      extracted_main: input.extractedMain,
      truncated: false,
    },
  };
}

export function fetchByCursor(cursor: string): ChunkOutput {
  const now = Date.now();
  reapExpired(now);

  const ref = cursorIndex.get(cursor);
  if (!ref) {
    throw new Error(`Unknown or expired cursor: ${cursor}`);
  }
  const entry = store.get(ref.entryId);
  if (!entry) {
    cursorIndex.delete(cursor);
    throw new Error(`Cursor's entry expired: ${cursor}`);
  }

  const chunks = splitIntoChunks(entry.text, entry.chunkSize);
  const chunkIndex = ref.chunkIndex;
  const chunk = chunks[chunkIndex];
  if (chunk == null) {
    throw new Error(`Chunk index out of range: ${chunkIndex}`);
  }

  cursorIndex.delete(cursor);

  let nextCursor: string | null = null;
  if (chunkIndex + 1 < chunks.length) {
    nextCursor = randomUUID();
    cursorIndex.set(nextCursor, {
      entryId: ref.entryId,
      chunkIndex: chunkIndex + 1,
    });
  }

  return {
    content: chunk,
    meta: {
      total_chars: entry.text.length,
      total_chunks: chunks.length,
      chunk_index: chunkIndex,
      chunk_chars: chunk.length,
      has_next: chunkIndex + 1 < chunks.length,
      next_cursor: nextCursor,
      source_url: entry.url,
      final_url: entry.finalUrl,
      content_type: entry.contentType,
      extracted_main: entry.extractedMain,
      truncated: false,
    },
  };
}

export function _resetForTests(): void {
  store.clear();
  cursorIndex.clear();
}
