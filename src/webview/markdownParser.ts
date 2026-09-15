/**
 * Tiny, dependency-free Markdown parser for rendering captured model
 * responses in the Webview (the source-message transcript). Model responses
 * are Markdown, but were previously shown as raw text - headings, code
 * fences, lists, and emphasis appeared as literal syntax, making them hard to
 * read.
 *
 * This module only *parses* Markdown into a small, serializable block/span
 * tree; the rendering is done by `Markdown.tsx`, which turns that tree into
 * React elements (so all text is escaped by React and there is no
 * `dangerouslySetInnerHTML`, hence no HTML-injection risk). Keeping the parser
 * pure and DOM-free also makes it unit-testable without the extension host,
 * matching the pattern used elsewhere in the codebase.
 *
 * Supported (a deliberately small subset, enough for readable answers):
 * fenced code blocks, ATX headings (`#`..`######`), unordered (`-`/`*`/`+`)
 * and ordered (`1.`) lists, blank-line-separated paragraphs, and inline
 * `code`, bold (`**`), italic (`*`/`_`), and `[text](url)` links.
 */

export type MarkdownSpan =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: number; spans: MarkdownSpan[] }
  | { type: "paragraph"; spans: MarkdownSpan[] }
  | { type: "code"; text: string; lang?: string }
  | { type: "list"; ordered: boolean; items: MarkdownSpan[][] };

interface InlinePattern {
  kind: MarkdownSpan["kind"];
  re: RegExp;
}

// Order matters: code spans are matched first so emphasis markers inside
// backticks are treated literally; links before bold/italic so their bracket
// text isn't consumed by emphasis parsing.
const INLINE_PATTERNS: InlinePattern[] = [
  { kind: "code", re: /`([^`]+)`/ },
  { kind: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { kind: "bold", re: /\*\*([^*]+)\*\*/ },
  { kind: "italic", re: /\*([^*]+)\*|_([^_]+)_/ },
];

/** Parses a single line/segment of text into inline spans. Never throws. */
export function parseInline(text: string): MarkdownSpan[] {
  if (text.length === 0) {
    return [];
  }

  let earliest: { index: number; length: number; span: MarkdownSpan } | undefined;
  for (const pattern of INLINE_PATTERNS) {
    const match = pattern.re.exec(text);
    if (!match) {
      continue;
    }
    if (earliest && match.index >= earliest.index) {
      continue;
    }
    let span: MarkdownSpan;
    if (pattern.kind === "link") {
      span = { kind: "link", text: match[1], href: match[2] };
    } else if (pattern.kind === "italic") {
      span = { kind: "italic", text: match[1] ?? match[2] };
    } else if (pattern.kind === "bold") {
      span = { kind: "bold", text: match[1] };
    } else {
      span = { kind: "code", text: match[1] };
    }
    earliest = { index: match.index, length: match[0].length, span };
  }

  if (!earliest) {
    return [{ kind: "text", text }];
  }

  const spans: MarkdownSpan[] = [];
  if (earliest.index > 0) {
    spans.push({ kind: "text", text: text.slice(0, earliest.index) });
  }
  spans.push(earliest.span);
  const rest = text.slice(earliest.index + earliest.length);
  spans.push(...parseInline(rest));
  return spans;
}

const FENCE_RE = /^```(\w*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;

/** Parses `input` Markdown text into a flat list of blocks. Never throws. */
export function parseMarkdown(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence (if present)
      blocks.push({ type: "code", text: codeLines.join("\n"), lang });
      continue;
    }

    // Blank line: skip.
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    // Heading.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }

    // List (consecutive items of the same ordered/unordered kind).
    const isUl = UL_RE.test(line);
    const isOl = OL_RE.test(line);
    if (isUl || isOl) {
      const ordered = isOl;
      const items: MarkdownSpan[][] = [];
      while (i < lines.length) {
        const itemMatch = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i]);
        if (!itemMatch) {
          break;
        }
        items.push(parseInline(itemMatch[1].trim()));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive non-blank lines that aren't another block kind.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", spans: parseInline(paraLines.join("\n")) });
  }

  return blocks;
}
