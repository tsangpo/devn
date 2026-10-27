import type { Environment } from '../platform/types';
import { clearEnvironment } from './environment';

// Fixed opt-out policy, not arbitrary configuration supplied by a remote profile.
export const codexTelemetry = {
  analytics: { enabled: false },
  feedback: { enabled: false },
  otel: {
    exporter: 'none',
    metrics_exporter: 'none',
    trace_exporter: 'none',
    log_user_prompt: false,
  },
};
export const codexTelemetryArgs = [
  'analytics.enabled=false',
  'feedback.enabled=false',
  'otel.exporter="none"',
  'otel.metrics_exporter="none"',
  'otel.trace_exporter="none"',
  'otel.log_user_prompt=false',
].flatMap((value) => ['-c', value]);

export const telemetryEnvironment = {
  OTEL_SDK_DISABLED: 'true',
  OTEL_TRACES_EXPORTER: 'none',
  OTEL_METRICS_EXPORTER: 'none',
  OTEL_LOGS_EXPORTER: 'none',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DO_NOT_TRACK: '1',
  CLAUDE_CODE_ENABLE_TELEMETRY: '0',
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
  CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL: '0',
  ENABLE_BETA_TRACING_DETAILED: '0',
  BETA_TRACING_ENDPOINT: '',
};

export function disableTelemetry(env: Environment): void {
  // OpenCode v2 creates its own exporter when this endpoint exists, even if the
  // standard SDK opt-out is set. Clear all inherited OTEL destinations/configs.
  clearEnvironment(env, [...Object.keys(telemetryEnvironment)], ['OTEL_']);
  Object.assign(env, telemetryEnvironment);
}

export function claudeTelemetry(existing: Record<string, unknown> = {}) {
  // Claude settings env can override process env. Clear retained OTEL values too.
  return {
    ...Object.fromEntries(
      Object.keys(existing)
        .filter((key) => key.toUpperCase().startsWith('OTEL_'))
        .map((key) => [key, '']),
    ),
    ...telemetryEnvironment,
  };
}
