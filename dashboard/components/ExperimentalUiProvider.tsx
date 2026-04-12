"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

type ExperimentalUiContextValue = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
};

const ExperimentalUiContext = createContext<ExperimentalUiContextValue | null>(null);

export function ExperimentalUiProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      enabled: true,
      setEnabled: () => {},
    }),
    [],
  );

  return (
    <ExperimentalUiContext.Provider value={value}>
      {children}
    </ExperimentalUiContext.Provider>
  );
}

export function useExperimentalUi() {
  const context = useContext(ExperimentalUiContext);
  if (!context) {
    throw new Error("useExperimentalUi must be used within ExperimentalUiProvider");
  }
  return context;
}
