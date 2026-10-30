import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { parseMarkdown, type Inline } from "./markdown";

/**
 * An answer written in Markdown, shown with its structure — headings, lists,
 * quotes, tables, code — and never as HTML. Links open in a new tab (the
 * desktop app hands them to the browser).
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={cn("space-y-2.5", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "p":
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Spans parts={line} />
                  </Fragment>
                ))}
              </p>
            );
          case "h":
            return (
              <p key={i} className={cn("font-medium text-foreground", b.level === 1 ? "text-[1.05rem]" : b.level === 2 ? "pt-1 text-[1rem]" : "text-[0.95rem]")}>
                <Spans parts={b.inline} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.kind === "ul" ? "ul" : "ol";
            return (
              <List key={i} className={cn("space-y-1 pl-5 marker:text-muted", b.kind === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans parts={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border-strong pl-3 text-muted-foreground">
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Spans parts={line} />
                  </Fragment>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[0.8rem] leading-relaxed text-foreground/90">
                {b.lang && <span className="mb-1 block text-[0.7rem] uppercase tracking-wide text-muted">{b.lang}</span>}
                <code>{b.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-[0.85rem]">
                  <thead className="bg-surface">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="border-b border-border px-3 py-1.5 font-medium text-foreground">
                          <Spans parts={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-0">
                        {row.map((c, j) => (
                          <td key={j} className="px-3 py-1.5 align-top">
                            <Spans parts={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

function Spans({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "strong" ? (
          <strong key={i} className="font-medium text-foreground">
            {p.text}
          </strong>
        ) : p.kind === "em" ? (
          <em key={i}>{p.text}</em>
        ) : p.kind === "code" ? (
          <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em]">
            {p.text}
          </code>
        ) : p.kind === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}
