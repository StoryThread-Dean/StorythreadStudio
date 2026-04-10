// ChatMarkdown.tsx -- Shared Markdown Renderer for Chat Bubbles
// ==============================================================
// Used by both the Profile Builder chat and the main editor's
// Writing Companion panel. Renders AI messages as formatted
// markdown with theme-appropriate dark-mode styling.
//
// Supported elements: bold, italic, bullet/numbered lists,
// blockquotes, horizontal rules, inline code. Headers (## ###)
// are rendered as bold text to prevent layout breaks in chat bubbles.

import ReactMarkdown from "react-markdown";

interface ChatMarkdownProps {
  content: string;
}

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-indigo-300">{children}</strong>,
        em: ({ children }) => <em className="italic text-[#ccccdd]">{children}</em>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        hr: () => <hr className="my-2 border-[#1e1e4a]" />,
        blockquote: ({ children }) => (
          <blockquote className="my-1 border-l-2 border-indigo-600/50 pl-2 text-[#aaaacc]">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => <p className="mb-1 font-semibold text-[#e0e0f5]">{children}</p>,
        h2: ({ children }) => <p className="mb-1 font-semibold text-[#e0e0f5]">{children}</p>,
        h3: ({ children }) => <p className="mb-1 font-semibold text-[#d0d0e5]">{children}</p>,
        code: ({ children }) => (
          <code className="rounded bg-[#1a1a3a] px-1 py-0.5 text-xs text-indigo-300">
            {children}
          </code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
