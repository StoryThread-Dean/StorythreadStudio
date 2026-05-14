// ChatMarkdown.tsx -- Shared Markdown Renderer for Chat Bubbles
// ==============================================================
// Used by both the Profile Builder chat and the main editor's
// Writing Companion panel. Renders AI messages as formatted
// markdown with theme-appropriate dark-mode styling.
//
// Supported elements: bold, italic, bullet/numbered lists,
// blockquotes, horizontal rules, inline code. Headers (## ###)
// are rendered as bold text to prevent layout breaks in chat bubbles.
//
// Markdown-preserving copy:
//   When the writer selects text in a chat bubble and copies, the default
//   browser behavior produces plain text -- bold becomes regular weight,
//   italics flatten out, lists lose their bullets. That makes pasting the
//   AI's reply back into the manuscript a manual reformatting job.
//   The onCopy handler below intercepts the copy, walks the selected DOM
//   range, and rewrites it as Markdown (** for bold, * for italic, <u>
//   for underline, etc.) so the paste lands ready-to-edit in the editor.
//
// Why React.memo + module-level components map?
//   The chat panel lives inside App, which re-renders for unrelated reasons
//   (backend-health polling, font changes, etc.). When ChatMarkdown's parent
//   re-renders, react-markdown receives a brand-new `components` object
//   (object literal in the JSX) and rebuilds its tree, replacing DOM nodes.
//   Replaced text nodes lose any selection -- the writer can't highlight
//   and copy because the selection vanishes within seconds.
//   Hoisting the components map to module scope gives it a stable identity,
//   and React.memo skips re-rendering when `content` is unchanged. Together
//   they keep the rendered DOM stable so selection persists.

import ReactMarkdown from "react-markdown";
import { memo } from "react";
import type React from "react";

interface ChatMarkdownProps {
  content: string;
}


// ── DOM-to-Markdown ──────────────────────────────────────────────────────────
// Recursive walker that converts a DOM subtree back into Markdown source.
// Used by the onCopy handler so highlight-and-copy from a chat bubble
// produces ready-to-paste Markdown. We classify by tag name and ALSO by
// the className styling we apply -- a future change to MARKDOWN_COMPONENTS
// that renders <strong> as a styled <span> would break a tag-only check.
// The className probe (`font-semibold`, `italic`) catches that case.
//
// We don't do full Markdown round-tripping (links, images, tables) because
// those aren't part of the chat output today. If the AI starts producing
// them in chat, extend this switch -- the existing branches stay valid.

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(nodeToMarkdown).join("");

  // Tag-based handling first; styling-based fallbacks at the bottom.
  switch (tag) {
    case "strong":
    case "b":
      return children ? `**${children}**` : "";
    case "em":
    case "i":
      return children ? `*${children}*` : "";
    case "u":
      // CommonMark has no underline. HTML <u> is the conventional fallback
      // and renders as expected in the CodeMirror Markdown editor we paste
      // into. We keep the same form on the way out so a future re-render
      // would look the same as the original chat output.
      return children ? `<u>${children}</u>` : "";
    case "code":
      return children ? `\`${children}\`` : "";
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "p":
      return children ? `${children}\n\n` : "";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      // ChatMarkdown renders headings as bold prose to avoid layout breaks
      // in chat bubbles. Mirror that on copy so the pasted output matches
      // what the writer saw.
      return children ? `**${children}**\n\n` : "";
    case "blockquote":
      // Prefix every line with "> ". Trailing newlines are normalized by
      // the caller so we don't double-pad here.
      return children
        ? children
            .split("\n")
            .map(line => (line ? `> ${line}` : ""))
            .join("\n") + "\n\n"
        : "";
    case "ul":
    case "ol":
      // The <li> branch emits its own bullet, so we just pass children
      // through. The blank line after ensures the list doesn't fuse into
      // a following paragraph.
      return children ? `${children}\n` : "";
    case "li": {
      const isOrdered = el.parentElement?.tagName.toLowerCase() === "ol";
      // For ordered lists we emit "1." for every item; Markdown renumbers
      // on render, so this is safe and avoids tracking per-list counters.
      const prefix = isOrdered ? "1. " : "- ";
      // Strip trailing paragraph-break newlines so list items stay tight.
      const trimmed = children.replace(/\n+$/, "");
      return `${prefix}${trimmed}\n`;
    }
    default:
      // Generic block / inline element: pass children through. Catches
      // <span>, <div>, and any future wrapper we add without breaking.
      // We also probe the className for styling-based bold/italic so a
      // future MARKDOWN_COMPONENTS change that styles <span> as bold
      // still produces ** in the copy.
      if (children) {
        const cls = el.className || "";
        if (typeof cls === "string") {
          const isBold   = /font-semibold|font-bold/.test(cls);
          const isItalic = /italic/.test(cls);
          if (isBold && isItalic) return `***${children}***`;
          if (isBold)             return `**${children}**`;
          if (isItalic)           return `*${children}*`;
        }
      }
      return children;
  }
}


// Handle the copy event on the chat bubble. Writes a Markdown version of
// the selection to the clipboard and suppresses the default plain-text
// copy. No-ops on collapsed selections (e.g. accidental Ctrl+C with no
// text highlighted) so we don't clobber whatever else is in the clipboard.
function handleChatCopy(e: React.ClipboardEvent<HTMLDivElement>): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  if (selection.rangeCount === 0) return;

  const range    = selection.getRangeAt(0);
  const fragment = range.cloneContents();

  let markdown = "";
  fragment.childNodes.forEach(child => {
    markdown += nodeToMarkdown(child);
  });

  // Collapse runs of 3+ newlines to two so block elements don't introduce
  // gaping vertical space. Trim leading/trailing whitespace so the paste
  // is tidy regardless of where the selection started or ended.
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  if (!markdown) return;  // Nothing useful to write; let the default run.

  e.clipboardData.setData("text/plain", markdown);
  e.preventDefault();
}

// Module-level so the object identity is stable across renders. Without this,
// every parent re-render hands react-markdown a new `components` reference
// and the entire tree gets rebuilt.
const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-indigo-300">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic text-text-primary">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
  hr: () => <hr className="my-2 border-border" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-1 border-l-2 border-indigo-600/50 pl-2 text-text-primary">
      {children}
    </blockquote>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold text-text-primary">{children}</p>,
  h2: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold text-text-primary">{children}</p>,
  h3: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 font-semibold text-text-primary">{children}</p>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-bg-panel px-1 py-0.5 text-xs text-indigo-300">
      {children}
    </code>
  ),
};

export const ChatMarkdown = memo(function ChatMarkdown({ content }: ChatMarkdownProps) {
  // Wrap in a div so we have a single host for the onCopy handler. The
  // handler intercepts copy events and writes a Markdown-flavored version
  // of the selection to the clipboard. See nodeToMarkdown above.
  return (
    <div onCopy={handleChatCopy}>
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
