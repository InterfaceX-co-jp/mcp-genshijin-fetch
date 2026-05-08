import { extractMainContent } from "./extract.js";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  contentType: string;
  status: number;
  markdown: string;
  byteLength: number;
  charLength: number;
  extractedMain: boolean;
}

const DEFAULT_USER_AGENT =
  "mcp-genshijin-fetch/0.1 (+https://github.com/InterfaceX-co-jp/mcp-genshijin-fetch)";

const MAX_BYTES = 25 * 1024 * 1024;

export async function fetchUrl(
  url: string,
  options: { userAgent?: string; extractMain?: boolean; timeoutMs?: number } = {},
): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept:
          "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/xhtml+xml;q=0.8, */*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `Response too large: ${buffer.byteLength} bytes (limit ${MAX_BYTES})`,
    );
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

  let markdown = text;
  let extractedMain = false;

  if (contentType.includes("text/markdown") || contentType.includes("text/plain")) {
    markdown = text;
  } else if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml") ||
    looksLikeHtml(text)
  ) {
    const extracted = extractMainContent(text, response.url, {
      preferReadability: options.extractMain ?? true,
    });
    markdown = extracted.markdown;
    extractedMain = extracted.extractedMain;
  }

  return {
    url,
    finalUrl: response.url,
    contentType,
    status: response.status,
    markdown,
    byteLength: buffer.byteLength,
    charLength: markdown.length,
    extractedMain,
  };
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 2048).toLowerCase();
  return head.includes("<html") || head.includes("<!doctype html");
}
