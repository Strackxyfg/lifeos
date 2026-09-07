import type { Variants, Transition } from "framer-motion";

/**
 * Motion language for LifeOS — restrained, Linear/Apple-grade.
 * Only opacity, translateY, and scale. 150–500ms. Never bounce.
 */
export const ease = [0.22, 1, 0.36, 1] as const;

export const springs: Record<string, Transition> = {
  soft: { type: "spring", stiffness: 240, damping: 30, mass: 0.9 },
  snappy: { type: "spring", stiffness: 420, damping: 34 },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.45, ease } },
};

/** Stagger children with a subtle cascade. */
export const stagger = (staggerChildren = 0.06, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** Standard reveal-on-scroll props. */
export const reveal = {
  initial: "hidden" as const,
  whileInView: "show" as const,
  viewport: { once: true, margin: "-80px" },
};
