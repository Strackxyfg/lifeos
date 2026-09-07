"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production: report to Sentry/logging here.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-sm text-danger">Something broke</p>
      <h1 className="mt-4 text-h2 tracking-tight text-gradient">This view hit an error.</h1>
      <p className="mt-3 max-w-sm text-muted-foreground">
        An unexpected error occurred. You can retry, or head back home.
      </p>
      <div className="mt-8 flex gap-3">
        <button onClick={reset} className={buttonVariants({ size: "lg" })}>
          <RotateCw className="h-4 w-4" /> Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "lg" })}>
          Go home
        </Link>
      </div>
      {error.digest && (
        <p className={cn("mt-6 font-mono text-[0.7rem] text-muted")}>ref: {error.digest}</p>
      )}
    </main>
  );
}
