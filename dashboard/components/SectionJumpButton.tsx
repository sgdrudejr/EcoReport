"use client";

import type { ReactNode } from "react";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function SectionJumpButton({
  targetId,
  focusAccountKey,
  searchParams,
  clearSearchParams,
  eventName,
  eventDetail,
  className,
  children,
}: {
  targetId: string | null;
  focusAccountKey?: string | null;
  searchParams?: Record<string, string | null | undefined>;
  clearSearchParams?: string[];
  eventName?: string;
  eventDetail?: unknown;
  className?: string;
  children: ReactNode;
}) {
  const isDisabled = !targetId;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        if (!targetId) return;

        const url = new URL(window.location.href);
        url.hash = targetId;
        const nextSearchParams = new URLSearchParams(url.search);

        for (const key of clearSearchParams ?? []) {
          nextSearchParams.delete(key);
        }

        if (focusAccountKey) {
          nextSearchParams.set("account", focusAccountKey);
          window.dispatchEvent(
            new CustomEvent("ecoreport:focus-account", {
              detail: focusAccountKey,
            }),
          );
        }

        for (const [key, value] of Object.entries(searchParams ?? {})) {
          if (value == null || value === "") {
            nextSearchParams.delete(key);
            continue;
          }

          nextSearchParams.set(key, value);
        }

        url.search = nextSearchParams.toString();

        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );

        if (eventName) {
          window.dispatchEvent(
            new CustomEvent(eventName, {
              detail: eventDetail,
            }),
          );
        }

        const section = document.getElementById(targetId);
        if (!section) return;

        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={joinClasses(
        className,
        isDisabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}
