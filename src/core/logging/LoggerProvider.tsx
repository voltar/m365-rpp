import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Logger } from "./Logger";
import { createLogger } from "./Logger";

const LoggerContext = createContext<Logger | undefined>(undefined);

interface LoggerProviderProps {
  readonly children: ReactNode;
}

export function LoggerProvider({ children }: LoggerProviderProps) {
  const logger = useMemo(() => createLogger(), []);

  return <LoggerContext.Provider value={logger}>{children}</LoggerContext.Provider>;
}

export function useLogger(): Logger {
  const logger = useContext(LoggerContext);

  if (!logger) {
    throw new Error("LoggerProvider is missing.");
  }

  return logger;
}
