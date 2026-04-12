"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function IntradayAutoRefresh({
  date,
  initialUpdatedAt,
}: {
  date: string | null;
  initialUpdatedAt: string | null;
}) {
  const router = useRouter();
  const latestSeenRef = useRef(initialUpdatedAt);

  useEffect(() => {
    if (!date) return undefined;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/intraday?date=${encodeURIComponent(date)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json();
        const updatedAt = payload?.updatedAt ?? null;
        if (updatedAt && latestSeenRef.current && updatedAt !== latestSeenRef.current) {
          latestSeenRef.current = updatedAt;
          router.refresh();
        } else if (updatedAt && !latestSeenRef.current) {
          latestSeenRef.current = updatedAt;
        }
      } catch {
        // ignore polling failures
      }
    }, 60000);

    return () => window.clearInterval(interval);
  }, [date, router]);

  return null;
}
