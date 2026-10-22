import { EditionGate } from "@/components/plans/edition-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <EditionGate feature="finance">{children}</EditionGate>;
}
