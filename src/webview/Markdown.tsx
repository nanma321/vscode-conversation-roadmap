/**
 * Renders the small Markdown block/span tree produced by `markdown.ts` into
 * React elements. All text is passed through React children (never
 * `dangerouslySetInnerHTML`), so it is escaped automatically and cannot inject
 * HTML - safe for rendering untrusted model output inside the Webview.
 *
 * Links are rendered as plain text with their URL shown in parentheses rather
 * than as navigable anchors: the Webview's CSP intentionally blocks
 * navigation, and the product design forbids opening arbitrary external
 * content, so showing the URL keeps the information without an inert/misleading
 * link.
 */
import * as React from "react";
import { MarkdownBlock, MarkdownSpan, parseMarkdown } from "./markdownParser";

function renderSpans(spans: MarkdownSpan[]): React.ReactNode[] {
  return spans.map((span, i) => {
    switch (span.kind) {
      case "bold":
        return <strong key={i}>{span.text}</strong>;
      case "italic":
        return <em key={i}>{span.text}</em>;
      case "code":
        return (
          <code key={i} className="md-inline-code">
            {span.text}
          </code>
        );
      case "link":
        return (
          <span key={i} className="md-link">
            {span.text} ({span.href})
          </span>
        );
      default:
        return <React.Fragment key={i}>{span.text}</React.Fragment>;
    }
  });
}

function renderBlock(block: MarkdownBlock, key: number): React.JSX.Element {
  switch (block.type) {
    case "heading": {
      // Cap at h4 so headings fit the detail panel's type scale.
      const level = Math.min(block.level + 2, 6);
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      return (
        <Tag key={key} className="md-heading">
          {renderSpans(block.spans)}
        </Tag>
      );
    }
    case "code":
      return (
        <pre key={key} className="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderSpans(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderSpans(item)}</li>
          ))}
        </ul>
      );
    default:
      return (
        <p key={key} className="md-p">
          {renderSpans(block.spans)}
        </p>
      );
  }
}

export function Markdown(props: { text: string; className?: string }): React.JSX.Element {
  const blocks = React.useMemo(() => parseMarkdown(props.text), [props.text]);
  return <div className={"markdown" + (props.className ? ` ${props.className}` : "")}>{blocks.map(renderBlock)}</div>;
}
