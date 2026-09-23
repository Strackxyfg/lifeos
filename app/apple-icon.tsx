import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand/mark";

/** The icon iOS puts on the home screen when LifeOS is added to it. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} />, size);
}
