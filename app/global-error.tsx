"use client";

import "./globals.css";

/** Catches errors in the root layout itself; must render its own html/body. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-sans antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
          <h1 className="text-h2 tracking-tight text-foreground">Something went wrong.</h1>
          <p className="mt-3 max-w-sm text-muted-foreground">
            The application hit an unexpected error. Please reload.
          </p>
          <button
            onClick={reset}
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-6 text-sm font-medium text-background"
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
