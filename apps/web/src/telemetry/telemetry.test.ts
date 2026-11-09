import { context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { describe, expect, it } from "vitest";
import { initTelemetry, telemetryConfig } from "./init";

const ORIGIN = "https://demo.example";

describe("telemetryConfig", () => {
  it("stays off when the OTLP URL is empty or missing", () => {
    expect(telemetryConfig({}, ORIGIN)).toBeNull();
    expect(telemetryConfig({ VITE_BROWSER_OTLP_URL: "  " }, ORIGIN)).toBeNull();
    expect(initTelemetry({ VITE_BROWSER_OTLP_URL: "" }, ORIGIN)).toBe(false);
  });

  it("resolves a same-origin collector path and adds no CORS propagation", () => {
    const config = telemetryConfig({ VITE_BROWSER_OTLP_URL: "/v1/traces", VITE_API_BASE_URL: "/api/v1" }, ORIGIN);
    expect(config?.tracesUrl).toBe("https://demo.example/v1/traces");
    expect(config?.propagateTraceHeaderCorsUrls).toEqual([]);
    expect(config?.ignoreUrls.some((pattern) => pattern.test("https://demo.example/v1/traces"))).toBe(true);
  });

  it("propagates to a cross-origin API base only", () => {
    const config = telemetryConfig(
      { VITE_BROWSER_OTLP_URL: "http://localhost:4318/v1/traces", VITE_API_BASE_URL: "https://api.example/api/v1" },
      ORIGIN,
    );
    const [pattern] = config?.propagateTraceHeaderCorsUrls ?? [];
    expect(pattern?.test("https://api.example/api/v1/incidents")).toBe(true);
    expect(pattern?.test("https://api.example/api/v1")).toBe(true);
    expect(pattern?.test("https://api.example/api/v10")).toBe(false);
    expect(pattern?.test("https://elsewhere.example/api/v1/incidents")).toBe(false);
  });
});

describe("initTelemetry", () => {
  it("registers W3C trace context propagation with service.name web", () => {
    const exporter = new InMemorySpanExporter();
    expect(
      initTelemetry({ VITE_BROWSER_OTLP_URL: "/v1/traces" }, ORIGIN, {
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    ).toBe(true);

    const carrier: Record<string, string> = {};
    trace.getTracer("test").startActiveSpan("probe", (span) => {
      propagation.inject(context.active(), carrier);
      span.end();
    });
    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(carrier.baggage).toBeUndefined();
    const [finished] = exporter.getFinishedSpans();
    expect(finished?.resource.attributes["service.name"]).toBe("web");
  });
});
