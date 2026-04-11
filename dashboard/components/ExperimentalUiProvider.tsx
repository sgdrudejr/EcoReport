"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "ecoreport:experimental-ui-visible";

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
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "true") {
        setEnabledState(true);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore storage failures
    }
  };

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
    }),
    [enabled],
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
