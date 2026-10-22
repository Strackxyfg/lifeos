import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { parseMarkdown, type Inline } from "./markdown";

/** An answer written in light Markdown, shown as text with its emphasis and lists — never as HTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={cn("space-y-2", className)}>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Spans parts={line} />
              </Fragment>
            ))}
          </p>
        ) : b.kind === "h" ? (
          <p key={i} className="font-medium text-foreground">
            <Spans parts={b.inline} />
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted">
            {b.items.map((item, j) => (
              <li key={j}>
                <Spans parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-muted">
            {b.items.map((item, j) => (
              <li key={j}>
                <Spans parts={item} />
              </li>
            ))}
          </ol>
        )
      )}
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
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}
