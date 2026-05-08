// genshijin compression — pure-Node prose compressor.
// Ported from genshijin-shrink/compress.js (MIT, InterfaceX-co-jp/genshijin).
// Same semantic boundary as genshijin-compress: code/URLs/paths/identifiers
// are protected; only prose is reduced.
//
// Protected (never mutated):
//   - fenced code blocks (``` ... ```)
//   - inline code (`...`)
//   - URLs (https?://...)
//   - filesystem paths (containing / or \)
//   - identifier-like tokens (CamelCase, snake_case, dotted.path)
//   - function-call-like tokens (foo(bar))
//   - version numbers (1.2.3)
//
// Compressed:
//   English: articles, fillers, pleasantries, hedges, leading prefixes
//   Japanese: 敬語語尾, クッション, 前置き, ぼかし, 形式名詞
//   Both: collapse repeated whitespace, capitalize sentence starts

const FILLERS =
  /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally)\b/gi;

const PLEASANTRIES =
  /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi;

const HEDGES =
  /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi;

const LEADERS =
  /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim;

const ARTICLES = /\b(?:a|an|the)\s+(?=[a-z])/gi;

const JA_KEIGO =
  /(?:です|ます|でした|ました|でしょう|ましょう|ございます|ください|くださいませ)(?=[。、！？\s]|$)/g;
const JA_CUSHION =
  /(?:基本的に|一応|とりあえず|ざっくり言うと|ちなみに|要するに|まあ|えーと|あのー)/g;
const JA_PREAMBLE =
  /(?:ご質問ありがとうございます|お力になれれば幸いです|お調べしたところ|ご確認いただけ(?:ますでしょう|たら)|よろしくお願いします)[、。]?/g;
const JA_HEDGE =
  /(?:かもしれません|と思われます|と思います|おそらく|たぶん|多分)(?=[。、！？\s]|$)/g;
const JA_FORMAL_NOUN = /(?:すること|するもの|するため)/g;

const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\bhttps?:\/\/\S+/gi,
  /\b[\w.-]*[/\\][\w./\\-]+/g,
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g,
  /\b\w+\.\w+(?:\.\w+)*\(\)?/g,
  /[A-Za-z_][A-Za-z_0-9]*\s*\([^)]*\)/g,
  /\b\d+\.\d+\.\d+\b/g,
];

// Placeholder uses Private Use Area code points (U+E000, U+E001) as
// delimiters. These never appear in real input, so the placeholder is
// invisible to all PROTECTED and prose regexes — no risk of an inserted
// placeholder colliding with a later pass and being re-protected
// (e.g. an ASCII delimiter like "GSHJN0/GSHJN" would match the path regex).
const PH_OPEN = "";
const PH_CLOSE = "";
const PLACEHOLDER_RE = /(\d+)/g;

function withProtectedSegments(
  text: string,
  transform: (working: string) => string,
): string {
  const segments: string[] = [];
  let working = text;
  for (const re of PROTECTED_PATTERNS) {
    working = working.replace(re, (match) => {
      const i = segments.length;
      segments.push(match);
      return `${PH_OPEN}${i}${PH_CLOSE}`;
    });
  }
  let out = transform(working);
  out = out.replace(PLACEHOLDER_RE, (_, i: string) => segments[+i]!);
  return out;
}

function compressProse(text: string): string {
  let s = text;
  s = s.replace(LEADERS, "");
  s = s.replace(PLEASANTRIES, "");
  s = s.replace(HEDGES, "");
  s = s.replace(FILLERS, "");
  s = s.replace(ARTICLES, "");
  s = s.replace(JA_PREAMBLE, "");
  s = s.replace(JA_CUSHION, "");
  s = s.replace(JA_HEDGE, "");
  s = s.replace(JA_KEIGO, "");
  s = s.replace(JA_FORMAL_NOUN, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
  return s.trim();
}

export interface CompressResult {
  compressed: string;
  before: number;
  after: number;
}

export function compress(text: string): CompressResult {
  if (typeof text !== "string" || text.length === 0) {
    return { compressed: text ?? "", before: 0, after: 0 };
  }
  const before = text.length;
  const compressed = withProtectedSegments(text, compressProse);
  return { compressed, before, after: compressed.length };
}

export { withProtectedSegments };
