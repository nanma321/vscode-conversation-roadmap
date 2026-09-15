import * as assert from "assert";
import { parseInline, parseMarkdown, MarkdownBlock } from "../../src/webview/markdownParser";

describe("parseInline", () => {
  it("returns a single text span for plain text", () => {
    assert.deepStrictEqual(parseInline("hello world"), [{ kind: "text", text: "hello world" }]);
  });

  it("parses bold, italic, and inline code", () => {
    assert.deepStrictEqual(parseInline("a **b** c"), [
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c" },
    ]);
    assert.deepStrictEqual(parseInline("x _y_ z"), [
      { kind: "text", text: "x " },
      { kind: "italic", text: "y" },
      { kind: "text", text: " z" },
    ]);
    assert.deepStrictEqual(parseInline("use `npm test` now"), [
      { kind: "text", text: "use " },
      { kind: "code", text: "npm test" },
      { kind: "text", text: " now" },
    ]);
  });

  it("treats emphasis markers inside inline code literally", () => {
    assert.deepStrictEqual(parseInline("`a *b* c`"), [{ kind: "code", text: "a *b* c" }]);
  });

  it("parses a link into text + href", () => {
    assert.deepStrictEqual(parseInline("see [docs](https://example.com) here"), [
      { kind: "text", text: "see " },
      { kind: "link", text: "docs", href: "https://example.com" },
      { kind: "text", text: " here" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses an ATX heading", () => {
    const blocks = parseMarkdown("# Title");
    assert.deepStrictEqual(blocks, [{ type: "heading", level: 1, spans: [{ kind: "text", text: "Title" }] }]);
  });

  it("parses a fenced code block with a language, preserving inner text", () => {
    const input = "```js\nconst x = 1;\nconsole.log(x);\n```";
    const blocks = parseMarkdown(input);
    assert.strictEqual(blocks.length, 1);
    const block = blocks[0];
    assert.strictEqual(block.type, "code");
    if (block.type === "code") {
      assert.strictEqual(block.lang, "js");
      assert.strictEqual(block.text, "const x = 1;\nconsole.log(x);");
    }
  });

  it("parses an unordered list", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    assert.strictEqual(blocks.length, 1);
    const block = blocks[0];
    assert.strictEqual(block.type, "list");
    if (block.type === "list") {
      assert.strictEqual(block.ordered, false);
      assert.strictEqual(block.items.length, 3);
      assert.deepStrictEqual(block.items[0], [{ kind: "text", text: "one" }]);
    }
  });

  it("parses an ordered list", () => {
    const blocks = parseMarkdown("1. first\n2. second");
    const block = blocks[0];
    assert.strictEqual(block.type, "list");
    if (block.type === "list") {
      assert.strictEqual(block.ordered, true);
      assert.strictEqual(block.items.length, 2);
    }
  });

  it("separates paragraphs on blank lines and keeps a code block distinct", () => {
    const input = "First para line one\nline two\n\n```\ncode\n```\n\nSecond para";
    const blocks = parseMarkdown(input);
    const types = blocks.map((b) => b.type);
    assert.deepStrictEqual(types, ["paragraph", "code", "paragraph"]);
  });

  it("applies inline formatting inside paragraphs and list items", () => {
    const blocks = parseMarkdown("This is **bold** text\n\n- item with `code`");
    const para = blocks[0] as Extract<MarkdownBlock, { type: "paragraph" }>;
    assert.ok(para.spans.some((s) => s.kind === "bold" && s.text === "bold"));
    const list = blocks[1] as Extract<MarkdownBlock, { type: "list" }>;
    assert.ok(list.items[0].some((s) => s.kind === "code" && s.text === "code"));
  });

  it("returns an empty block list for empty input", () => {
    assert.deepStrictEqual(parseMarkdown(""), []);
    assert.deepStrictEqual(parseMarkdown("\n\n"), []);
  });
});
