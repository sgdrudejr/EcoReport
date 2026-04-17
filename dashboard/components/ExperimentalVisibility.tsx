"use client";

import type { ReactNode } from "react";
import { useExperimentalUi } from "@/components/ExperimentalUiProvider";

export default function ExperimentalVisibility({
  children,
}: {
  children: ReactNode;
}) {
  const { enabled } = useExperimentalUi();
  if (!enabled) return null;
  return <>{children}</>;
}
