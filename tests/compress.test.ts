import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compress } from "../src/compress.js";

describe("compress: English prose", () => {
  it("removes articles before lowercase nouns", () => {
    const input = "The server is a critical component of the system.";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /\bthe\s+server\b/i);
    assert.doesNotMatch(out, /\ba\s+critical\b/i);
  });

  it("removes fillers", () => {
    const input = "This is just really very simply a test.";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /\b(?:just|really|very|simply)\b/i);
  });

  it("removes pleasantries", () => {
    const input = "Please confirm. Thanks for your help.";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /\b(?:please|thanks)\b/i);
  });

  it("strips leading prefixes", () => {
    const input = "I'll fix the bug now.";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /^I'?ll/i);
  });
});

describe("compress: Japanese prose", () => {
  it("strips 敬語語尾", () => {
    const input = "これはテストです。動きます。";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /です。|ます。/);
  });

  it("removes クッション言葉", () => {
    const input = "基本的にこれは動く。一応確認した。";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /基本的に|一応/);
  });

  it("removes ぼかし表現 at sentence end", () => {
    const input = "動くかもしれません。大丈夫、たぶん。";
    const out = compress(input).compressed;
    assert.doesNotMatch(out, /かもしれません|たぶん/);
  });
});

describe("compress: protected patterns", () => {
  it("never alters fenced code blocks", () => {
    const code = "```js\nconst the = a; // please\n```";
    const input = `Please see the example: ${code}`;
    const out = compress(input).compressed;
    assert.ok(out.includes(code), `code block should survive: ${out}`);
  });

  it("never alters inline code", () => {
    const input = "Use `the.config` to configure.";
    const out = compress(input).compressed;
    assert.ok(out.includes("`the.config`"));
  });

  it("never alters URLs", () => {
    const input = "See https://example.com/the/path?just=1 for details.";
    const out = compress(input).compressed;
    assert.ok(out.includes("https://example.com/the/path?just=1"));
  });

  it("never alters identifiers (CamelCase, snake_case, dotted)", () => {
    const input = "Call FooBar_Service.theMethod() with the args.";
    const out = compress(input).compressed;
    assert.ok(out.includes("FooBar_Service"));
    assert.ok(out.includes(".theMethod"));
  });

  it("never alters version numbers", () => {
    const input = "Upgrade to the version 1.2.3 of the package.";
    const out = compress(input).compressed;
    assert.ok(out.includes("1.2.3"));
  });

  it("never alters filesystem paths", () => {
    const input = "Edit the file at /etc/the/config.toml please.";
    const out = compress(input).compressed;
    assert.ok(out.includes("/etc/the/config.toml"));
  });
});

describe("compress: shape", () => {
  it("returns before/after stats", () => {
    const r = compress("Please see the docs.");
    assert.equal(typeof r.before, "number");
    assert.equal(typeof r.after, "number");
    assert.ok(r.after <= r.before);
  });

  it("handles empty input", () => {
    const r = compress("");
    assert.equal(r.compressed, "");
    assert.equal(r.before, 0);
    assert.equal(r.after, 0);
  });

  it("achieves measurable reduction on a verbose paragraph", () => {
    const input =
      "I think basically the server might really just be the right tool. " +
      "It seems to work, please confirm.";
    const r = compress(input);
    assert.ok(
      r.after < r.before * 0.8,
      `expected at least 20% reduction, got ${r.before}→${r.after}`,
    );
  });
});
