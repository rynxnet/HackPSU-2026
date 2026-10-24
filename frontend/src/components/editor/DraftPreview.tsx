"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { BibEntry, Figure } from "@/lib/types";
import { renderCitationsForPreview } from "@/lib/citations";

interface DraftPreviewProps {
  content: string;
  bibliography: BibEntry[];
  figures: Figure[];
}

/** Manuscript-style rendering of a Markdown draft, matching what the export produces. */
export function DraftPreview({ content, bibliography, figures }: DraftPreviewProps) {
  const { text, cited } = useMemo(() => {
    const byLabel = new Map(figures.map((f) => [f.label, f]));
    const numbers = new Map<string, number>();
    content.replace(/^!\[[^\]]*\]\(figure:([a-z0-9-]+)\)\s*$/gm, (m, label: string) => {
      if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
      return m;
    });
    const md = content
      // Drop an empty trailing References heading; the list is generated below
      .replace(/\n#{1,3}\s*(references|bibliography)\s*$/i, "\n")
      .replace(/\[?@fig:([a-z0-9-]+)\]?/g, (m, label) => (numbers.has(label) ? `Figure ${numbers.get(label)}` : m))
      .replace(/^!\[([^\]]*)\]\(figure:([a-z0-9-]+)\)\s*$/gm, (m, caption, label) => {
        const fig = byLabel.get(label);
        if (!fig) return `> ⚠️ Missing figure \`${label}\``;
        return `![Figure ${numbers.get(label)}. ${caption || fig.caption}](${fig.image_url})`;
      });
    return renderCitationsForPreview(md, bibliography);
  }, [content, bibliography, figures]);

  return (
    <div className="h-full overflow-y-auto bg-[#fbfbf8] text-[#1f1f1f]">
      <article className="max-w-[680px] mx-auto px-10 py-10 font-serif text-[15px] leading-7">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            h1: ({ children }) => <h1 className="text-3xl font-bold text-center mb-6 leading-tight">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xl font-bold mt-8 mb-3">{children}</h2>,
            h3: ({ children }) => <h3 className="text-lg font-semibold mt-6 mb-2">{children}</h3>,
            p: ({ children }) => <p className="mb-4 text-justify">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
            blockquote: ({ children }) => <blockquote className="border-l-4 border-[#c9c9c0] pl-4 italic text-[#444] my-4">{children}</blockquote>,
            code: ({ children }) => <code className="font-mono text-[13px] bg-[#eeeee8] px-1 rounded">{children}</code>,
            a: ({ children, href }) => <a href={href} className="text-[#1d4ed8] underline" target="_blank" rel="noreferrer">{children}</a>,
            // Markdown wraps images in <p>, so use block spans rather than <figure> to keep the HTML valid
            img: ({ src, alt }) => (
              <span className="block my-6 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src as string} alt={alt || ""} className="mx-auto max-w-full border border-[#e5e5df]" />
                {alt && <span className="block text-sm text-[#555] mt-2">{alt}</span>}
              </span>
            ),
            table: ({ children }) => <table className="mx-auto my-4 text-sm border-collapse">{children}</table>,
            th: ({ children }) => <th className="border-b-2 border-[#333] px-3 py-1 text-left">{children}</th>,
            td: ({ children }) => <td className="border-b border-[#ddd] px-3 py-1">{children}</td>,
          }}
        >
          {text}
        </ReactMarkdown>

        {cited.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold mb-3">References</h2>
            <ol className="space-y-2 text-sm">
              {[...cited].sort((a, b) => a.formatted.localeCompare(b.formatted)).map((e) => (
                <li key={e.key} className="pl-6 -indent-6">{e.formatted}</li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </div>
  );
}
