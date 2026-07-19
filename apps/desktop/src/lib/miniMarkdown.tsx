import type { ReactNode } from "react";

/**
 * A tiny, deliberately non-exhaustive markdown renderer for assistant
 * replies: fenced code blocks, **bold**, `inline code`, and -/* or 1. lists
 * - enough for the kind of answers this assistant gives. Anything else
 * (tables, headings, links) renders as plain text rather than pulling in a
 * markdown dependency for a chat bubble.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part.length > 0)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return <code key={key}>{part.slice(1, -1)}</code>;
      }
      return <span key={key}>{part}</span>;
    });
}

const isBulletLine = (line: string) => /^[-*]\s+/.test(line);
const isNumberedLine = (line: string) => /^\d+[.)]\s+/.test(line);
const stripListMarker = (line: string) => line.replace(/^([-*]|\d+[.)])\s+/, "");

function renderProseBlock(block: string, key: string): ReactNode {
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 0 && lines.every(isBulletLine)) {
    return (
      <ul key={key}>
        {lines.map((line, i) => (
          <li key={`${key}-li-${i}`}>{renderInline(stripListMarker(line), `${key}-${i}`)}</li>
        ))}
      </ul>
    );
  }
  if (lines.length > 0 && lines.every(isNumberedLine)) {
    return (
      <ol key={key}>
        {lines.map((line, i) => (
          <li key={`${key}-li-${i}`}>{renderInline(stripListMarker(line), `${key}-${i}`)}</li>
        ))}
      </ol>
    );
  }
  return <p key={key}>{renderInline(block.trim(), key)}</p>;
}

/** `text.split()` against a 2-capture-group regex interleaves matches as
 *  [prose, lang, code, prose, lang, code, …, prose] - walked 3 at a time
 *  below. An unclosed fence (mid-stream, before the closing ``` arrives)
 *  simply has no match yet, so it renders as plain prose until it closes. */
const CODE_FENCE = /```(\w*)\n?([\s\S]*?)```/g;

export function renderMiniMarkdown(text: string): ReactNode {
  if (!text) return null;
  const segments = text.split(CODE_FENCE);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < segments.length; i += 3) {
    const prose = segments[i];
    if (prose && prose.trim().length > 0) {
      prose
        .split(/\n{2,}/)
        .filter((block) => block.trim().length > 0)
        .forEach((block, bi) => nodes.push(renderProseBlock(block, `p-${i}-${bi}`)));
    }
    const code = segments[i + 2];
    if (code !== undefined) {
      nodes.push(
        <pre key={`code-${i}`}>
          <code>{code.replace(/\n$/, "")}</code>
        </pre>,
      );
    }
  }
  return <>{nodes}</>;
}
