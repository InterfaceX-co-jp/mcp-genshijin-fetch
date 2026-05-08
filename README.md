# mcp-genshijin-fetch

> Honest URL fetcher for Claude Code & other MCP clients. No Haiku summarization. No silent truncation. Cursor-based pagination for long pages.

`mcp-genshijin-fetch` is a [Model Context Protocol](https://modelcontextprotocol.io) server that fetches URLs and returns the raw markdown — straight to your main model, with full metadata.

## なぜ作った

Claude Code 標準の `WebFetch` は (2026-05時点):

1. **Haiku で要約してから主モデルに渡す** — ユーザーには見えない伝言ゲーム化
2. **80個の信頼ドメイン以外**は全て要約経路 (`Content-Type: text/markdown` + 信頼ドメイン + 10万文字以下 すべて満たす場合のみバイパス)
3. **silent truncate** — 10万文字超は無警告で切断、後半が消える

問題提起: <https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary>

このMCP server は:

- URL を fetch → HTML→Markdown 変換 (Mozilla Readability 経由) → **そのまま主モデルへ返却**
- 長ページは cursor pagination で分割。`has_next` / `total_chunks` / `next_cursor` を明示
- 切断・要約は一切なし

## インストール

```bash
npm install -g mcp-genshijin-fetch
# or
npx mcp-genshijin-fetch
```

## Claude Code / Claude Desktop で使う

`~/.claude.json` (Claude Code) or `claude_desktop_config.json` に:

```jsonc
{
  "mcpServers": {
    "genshijin-fetch": {
      "command": "npx",
      "args": ["-y", "mcp-genshijin-fetch"]
    }
  }
}
```

主モデルで `fetch` ツール使用 → WebFetch を完全置換。

## 提供ツール

### `fetch`

URL を取得して markdown 返却。長ページは最初の chunk を返却し `next_cursor` で続きを案内。

| 引数 | 型 | デフォルト | 説明 |
|---|---|---|---|
| `url` | string | (必須) | 取得URL |
| `extract_main` | bool | `true` | Mozilla Readability で本文抽出。`false` で全body markup |
| `chunk_size` | int | `80000` | 1 chunk あたりの目安文字数。見出し境界優先で分割 |
| `timeout_ms` | int | `30000` | ネットワークtimeout |

返却 (text content):

```
<!-- mcp-genshijin-fetch meta
source: https://example.com/article
content-type: text/html; charset=utf-8
chunk: 1/3 (78421 chars of 234150 total)
extracted_main: true
has_next: true — call fetch_chunk with cursor "9c4a..."
-->

# Article Title

...markdown body...
```

### `fetch_chunk`

`next_cursor` 渡して次chunk取得。cursor は単発使用、30分でTTL失効。

| 引数 | 型 | 説明 |
|---|---|---|
| `cursor` | string | 直前の `fetch` / `fetch_chunk` が返した `next_cursor` |

## 設計上の制約

- **メモリ内cursor store**: server 再起動で全 cursor 失効
- **本文抽出はReadability依存**: news/blog 系で精度高、SPA系では `extract_main: false` 推奨
- **同時並列リクエスト制限なし**: 自分で制御 (悪用回避)
- **robots.txt は尊重しない** (curl 同等の挙動)。User-Agent は識別可能

## genshijin との関係

[genshijin](https://github.com/InterfaceX-co-jp/genshijin) ecosystem の一部。哲学:「意味保持で減量」。
本server は `fetch` 経路の不可逆圧縮 (Haiku要約) を排除 — genshijin が出力経路で行う**可逆**圧縮の対極にある問題への回答。

## ロードマップ

- [ ] genshijin圧縮統合 (`fetch` に `compress: true` オプション)
- [ ] defuddle backend 切替オプション
- [ ] robots.txt opt-in
- [ ] cache layer (TTL付き)

## ライセンス

MIT
