import type { Metadata } from "next";
import { Generator } from "@/components/generation/generator";

export const metadata: Metadata = {
  title: "Building your workspace",
  robots: { index: false, follow: false },
};

export default function GeneratePage() {
  return <Generator />;
}
