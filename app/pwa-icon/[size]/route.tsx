import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand/mark";

/** The home-screen icons the manifest lists, rendered once at build time. */
export const dynamic = "force-static";

const SIZES = [192, 512] as const;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = SIZES.find((s) => String(s) === raw);
  if (!size) return new Response("Not found", { status: 404 });
  return new ImageResponse(<BrandMark size={size} />, { width: size, height: size });
}
