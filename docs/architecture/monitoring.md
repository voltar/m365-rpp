# Monitoring

EO-303 defines the operational monitoring baseline for Version 1.0.

## Runtime Health

The application exposes a client-side health snapshot through:

```typescript
getMonitoringHealthSnapshot()
```

The snapshot includes:

- overall health status
- application version
- source revision
- environment name
- configuration status
- recent structured events
- recent operational metrics

Static deployments also include:

```text
dist/health.json
```

This file verifies that the deployed artefact contains a basic health resource. Runtime health is still produced in the application because this is a static Teams/SPFx-style frontend.

## Structured Logging

The existing EO-010 logger records structured events and now forwards sanitized entries to the monitoring buffer.

Tracked events include:

- application startup
- navigation
- repository bootstrap
- integration failures
- React render failures
- application errors

Sensitive keys such as tokens, secrets, passwords, cookies, authorization headers, and API keys are redacted before entries are stored in monitoring state.

## Metrics

EO-303 introduces a lightweight client-side metric buffer. It records selected operational metrics such as application startup time. Future backend or Application Insights integration can replace this buffer without changing the application logging boundary.

## Diagnostics

Administrators can inspect:

- release version
- source revision
- environment name
- runtime configuration status
- recent events
- recent metrics

## Boundaries

EO-303 does not implement 24/7 support, automated incident response, external monitoring platform integration, AI diagnostics, infrastructure monitoring, SLO reporting, or business intelligence reporting.
