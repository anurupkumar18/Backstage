import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type SpanProcessor, WebTracerProvider } from "@opentelemetry/sdk-trace-web";

export const SERVICE_NAME = "web";

export interface TelemetryEnv {
  VITE_BROWSER_OTLP_URL?: string;
  VITE_API_BASE_URL?: string;
}

export interface TelemetryConfig {
  /** Full OTLP/HTTP traces URL, e.g. https://demo.example/v1/traces. */
  tracesUrl: string;
  /** Cross-origin URLs that also receive traceparent. Same-origin fetches get it without being listed. */
  propagateTraceHeaderCorsUrls: RegExp[];
  ignoreUrls: RegExp[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns null when VITE_BROWSER_OTLP_URL is empty: telemetry stays off. */
export function telemetryConfig(env: TelemetryEnv, origin: string): TelemetryConfig | null {
  const raw = env.VITE_BROWSER_OTLP_URL?.trim();
  if (!raw) {
    return null;
  }
  const tracesUrl = new URL(raw, origin).href;
  const api = new URL(env.VITE_API_BASE_URL?.trim() || "/api/v1", origin);
  const apiPrefix = api.origin + api.pathname.replace(/\/$/, "");
  return {
    tracesUrl,
    propagateTraceHeaderCorsUrls: api.origin === origin ? [] : [new RegExp(`^${escapeRegExp(apiPrefix)}(/|$)`)],
    ignoreUrls: [new RegExp(`^${escapeRegExp(tracesUrl)}`)],
  };
}

let provider: WebTracerProvider | null = null;

export interface InitOptions {
  /** Test hook. Defaults to a batch processor exporting to the configured OTLP URL. */
  spanProcessors?: SpanProcessor[];
}

/**
 * Registers the browser tracer once. Spans carry service.name=web, URL and timing only. Nothing here reads
 * tokens, caption text or request bodies; the Authorization header is never recorded by the fetch instrumentation.
 */
export function initTelemetry(env: TelemetryEnv, origin: string, options: InitOptions = {}): boolean {
  if (provider) {
    return true;
  }
  const config = telemetryConfig(env, origin);
  if (!config) {
    return false;
  }
  provider = new WebTracerProvider({
    resource: resourceFromAttributes({ "service.name": SERVICE_NAME }),
    spanProcessors: options.spanProcessors ?? [new BatchSpanProcessor(new OTLPTraceExporter({ url: config.tracesUrl }))],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: config.propagateTraceHeaderCorsUrls,
        ignoreUrls: config.ignoreUrls,
        clearTimingResources: true,
      }),
    ],
  });
  return true;
}
