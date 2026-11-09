import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@dash0/sdk-web", () => ({ init: vi.fn(), reportError: vi.fn() }));
import { init, reportError } from "@dash0/sdk-web";
import { initTelemetry, telemetryConfig, scrubUrlAttributes } from "./init";
const ORIGIN = "https://demo.example";
beforeEach(() => vi.clearAllMocks());
describe("Dash0 privacy configuration", () => {
  it("stays off when disabled or the collector is not same-origin", () => {
    expect(telemetryConfig({}, ORIGIN)).toBeNull();
    expect(
      telemetryConfig(
        { VITE_BROWSER_OTLP_URL: "https://vendor.example/v1/traces" },
        ORIGIN,
      ),
    ).toBeNull();
    expect(initTelemetry({}, ORIGIN)).toBe(false);
  });
  it("uses one credential-free same-origin endpoint for SDK traces and logs", () => {
    const config = telemetryConfig(
      {
        VITE_BROWSER_OTLP_URL: "/v1/traces",
        VITE_API_BASE_URL: "https://api.example/api/v1",
      },
      ORIGIN,
    )!;
    expect(config.endpoint).toEqual({ url: `${ORIGIN}/otel`, authToken: "" });
    expect(config.enabledInstrumentations).toEqual([
      "@dash0/navigation",
      "@dash0/web-vitals",
      "@dash0/fetch",
      "@dash0/error",
    ]);
    expect(config.headersToCapture).toEqual([]);
    expect(config.sessionRecording).toBeUndefined();
    expect(
      config.propagators?.[0]?.match[0]?.test(
        "https://api.example/api/v1/incidents",
      ),
    ).toBe(true);
    expect(
      config.propagators?.[0]?.match[0]?.test("https://api.example/api/v10"),
    ).toBe(false);
  });
  it("scrubs query, fragment and credentials from every URL attribute", () => {
    const attrs = scrubUrlAttributes({
      "url.full": "https://user:pass@demo.example/api?q=token#secret",
      "url.query": "q=token",
      "url.fragment": "secret",
      "url.path": "/api",
      "url.scheme": "https",
      "url.domain": "demo.example",
    });
    expect(attrs["url.full"]).toBe("https://demo.example/api");
    expect(attrs["url.query"]).toBe("REDACTED");
    expect(attrs["url.fragment"]).toBe("REDACTED");
    expect(JSON.stringify(attrs)).not.toMatch(/token|secret|user|pass/);
  });
  it("initializes once and reports browser errors without their message or stack", () => {
    expect(initTelemetry({ VITE_BROWSER_OTLP_URL: "/v1/traces" }, ORIGIN)).toBe(
      true,
    );
    expect(initTelemetry({ VITE_BROWSER_OTLP_URL: "/v1/traces" }, ORIGIN)).toBe(
      true,
    );
    expect(init).toHaveBeenCalledTimes(1);
    const config = vi.mocked(init).mock.calls[0]![0];
    expect(
      config.ignoreErrorMessages?.[0]?.test(
        "Email alice@example.com token=private",
      ),
    ).toBe(true);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "alice@example.com",
        error: new Error("private"),
      }),
    );
    expect(reportError).toHaveBeenCalledWith("BACKSTAGE browser error", {
      attributes: { "error.source": "window" },
    });
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toMatch(
      /alice|private/,
    );
  });
});
