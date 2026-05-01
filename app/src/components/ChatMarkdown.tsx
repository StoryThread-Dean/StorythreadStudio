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

interface ChatMarkdownProps {
  content: string;
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
  return (
    <ReactMarkdown components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
});
