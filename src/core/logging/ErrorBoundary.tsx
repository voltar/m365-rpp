import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { TranslationKey } from "../../localization/translations";
import type { ApplicationError } from "./ApplicationError";
import { createApplicationError } from "./ApplicationError";
import { ErrorBanner } from "./ErrorBanner";
import type { Logger } from "./Logger";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly component: string;
  readonly logger: Logger;
  readonly t: (key: TranslationKey) => string;
}

interface ErrorBoundaryState {
  readonly error?: ApplicationError;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {};

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error: createApplicationError({
        severity: "error",
        source: "react",
        component: "ErrorBoundary",
        operation: "render",
        message: "React render failure.",
        innerError: error
      })
    };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const applicationError = createApplicationError({
      severity: "error",
      source: "react",
      component: this.props.component,
      operation: "componentDidCatch",
      message: "A React component failed to render.",
      innerError: {
        error,
        componentStack: errorInfo.componentStack
      }
    });

    this.setState({ error: applicationError });
    this.props.logger.logApplicationError(applicationError);
  }

  public override render(): ReactNode {
    if (this.state.error) {
      return <ErrorBanner error={this.state.error} onReset={this.reset} t={this.props.t} />;
    }

    return this.props.children;
  }

  private readonly reset = () => {
    this.props.logger.info("User dismissed an application error.", {
      source: "ui",
      component: this.props.component,
      operation: "errorBoundaryReset",
      details: { correlationId: this.state.error?.correlationId }
    });

    this.setState({ error: undefined });
  };
}
