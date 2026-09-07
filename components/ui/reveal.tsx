"use client";

import { motion } from "framer-motion";
import { fadeUp, reveal, stagger } from "@/lib/motion";

/** Scroll-reveal wrapper — fade + rise, honoring reduced-motion. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered container — children should be <RevealItem>. */
export function RevealGroup({
  children,
  className,
  gap = 0.06,
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={stagger(gap)}
      {...reveal}
    >
      {children}
    </motion.div>
  );
}

/**
 * A single staggered child. Use inside <RevealGroup>.
 * This is a client component so `motion.*` is never referenced across the
 * RSC boundary (which would resolve to undefined in a server component).
 */
export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "figure";
}) {
  const M = as === "figure" ? motion.figure : motion.div;
  return (
    <M variants={fadeUp} className={className}>
      {children}
    </M>
  );
}
