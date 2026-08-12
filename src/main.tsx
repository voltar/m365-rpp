import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "./components/AppShell";
import { LoggerProvider } from "./core/logging";
import { recordMonitoringMetric } from "./infrastructure/monitoring";
import { resolveInitialLocale } from "./localization/localizationService";
import { loadLocale } from "./localization/translations";
import "./styles/designTokens.css";
import "./styles/global.css";

const startupStartedAt = performance.now();
void loadLocale(resolveInitialLocale());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LoggerProvider>
      <AppShell />
    </LoggerProvider>
  </React.StrictMode>
);

window.requestAnimationFrame(() => {
  recordMonitoringMetric({
    name: "applicationStartup",
    unit: "millisecond",
    value: Math.round(performance.now() - startupStartedAt)
  });
});
