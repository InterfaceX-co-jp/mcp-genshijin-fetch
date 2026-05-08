import { JSDOM } from "jsdom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ExtractResult {
  markdown: string;
  extractedMain: boolean;
  title?: string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});

turndown.addRule("preserveCode", {
  filter: ["pre"],
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const codeEl = el.querySelector("code");
    const lang =
      codeEl?.className.match(/language-([\w-]+)/)?.[1] ??
      el.className.match(/language-([\w-]+)/)?.[1] ??
      "";
    const text = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
  },
});

turndown.remove(["script", "style", "noscript", "iframe"]);

export function extractMainContent(
  html: string,
  url: string,
  options: { preferReadability?: boolean } = {},
): ExtractResult {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  if (options.preferReadability !== false && isProbablyReaderable(document)) {
    try {
      const reader = new Readability(document.cloneNode(true) as Document);
      const article = reader.parse();
      if (article && article.content) {
        const markdown = turndown.turndown(article.content);
        const titlePart = article.title ? `# ${article.title}\n\n` : "";
        return {
          markdown: `${titlePart}${markdown}`.trim() + "\n",
          extractedMain: true,
          title: article.title ?? undefined,
        };
      }
    } catch {
      // fall through to whole-document conversion
    }
  }

  const bodyHtml = document.body?.innerHTML ?? html;
  const markdown = turndown.turndown(bodyHtml);
  return {
    markdown: markdown.trim() + "\n",
    extractedMain: false,
    title: document.title || undefined,
  };
}
