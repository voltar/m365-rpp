import type { ReactNode } from "react";
import type { ThemeMode } from "../models/navigation";

interface AppLayoutProps {
  readonly themeMode: ThemeMode;
  readonly header?: ReactNode;
  readonly rail?: ReactNode;
  readonly navigation: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

export function AppLayout({ themeMode, header, rail, navigation, footer, children }: AppLayoutProps) {
  return (
    <div
      className={`appShell ${themeMode === "dark" ? "appShellDark" : "appShellLight"} ${rail ? "" : "appShellNoRail"} ${header ? "" : "appShellNoHeader"}`}
    >
      {header}
      {rail}
      <div className="workspaceShell">
        {navigation}
        <main className="appMain">{children}</main>
        <footer className="appFooter">{footer}</footer>
      </div>
    </div>
  );
}
