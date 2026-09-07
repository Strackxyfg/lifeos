"use client";

import { useState, useTransition } from "react";
import { togglePreference } from "@/app/actions/preferences";
import { SwitchTrack } from "@/components/ui/switch";

/**
 * A Switch that persists. Optimistic: flips immediately, reverts if the
 * server rejects the write. Shares its visuals with the base switch so both
 * stay aligned.
 */
export function PreferenceSwitch({
  prefKey,
  defaultChecked,
  label,
}: {
  prefKey: string;
  defaultChecked: boolean;
  label: string;
}) {
  const [on, setOn] = useState(defaultChecked);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    start(async () => {
      const res = await togglePreference(prefKey, next);
      if (!res.ok) setOn(!next);
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={toggle}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SwitchTrack on={on} pending={pending} />
    </button>
  );
}
