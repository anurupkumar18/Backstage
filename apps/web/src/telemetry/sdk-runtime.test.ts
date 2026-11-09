import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

it("the pinned SDK records same-origin API requests and navigation without tracing its telemetry transport", async () => {
  const received: { url: string; init?: RequestInit }[] = [];
  const originalFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      received.push({ url: String(input), init });
      return new Response("{}", { status: 200 });
    },
  );
  vi.stubGlobal("fetch", originalFetch);
  window.fetch = originalFetch;
  Object.defineProperty(window, "Request", {
    configurable: true,
    value: Request,
  });
  Object.defineProperty(performance, "getEntriesByType", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(performance, "getEntriesByName", {
    configurable: true,
    value: () => [],
  });
  const { telemetryConfig } = await import("./init");
  const { init } = await import("@dash0/sdk-web");
  const config = telemetryConfig(
    { VITE_BROWSER_OTLP_URL: "/v1/traces" },
    window.location.origin,
  )!;
  init({
    ...config,
    maxWaitForResourceTimingsMillis: 1,
    maxToleranceForResourceTimingsMillis: 1,
  });
  const response = await window.fetch(
    `${window.location.origin}/api/v1/status?q=secret#private`,
  );
  await response.text();
  await window.fetch(`${window.location.origin}/otel/v1/traces`);
  window.history.pushState({}, "", "/inspector?q=secret#private");
  window.dispatchEvent(new Event("pagehide"));
  await waitFor(() =>
    expect(received.some((item) => item.url.endsWith("/otel/v1/logs"))).toBe(
      true,
    ),
  );
  const api = received.find((item) => item.url.includes("/api/v1/status"))!;
  expect(new Headers(api.init?.headers).get("traceparent")).toMatch(
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
  );
  await waitFor(
    () =>
      expect(
        received.some(
          (item) => item.url.endsWith("/otel/v1/traces") && item.init?.body,
        ),
      ).toBe(true),
    { timeout: 3000 },
  );
  const transportBatches = received.filter(
    (item) => item.url.includes("/otel/") && item.init?.body,
  );
  const spans = transportBatches.flatMap((item) => {
    const body = JSON.parse(String(item.init?.body));
    return (body.resourceSpans ?? []).flatMap(
      (resource: {
        scopeSpans: {
          spans: {
            attributes: { key: string; value: { stringValue?: string } }[];
          }[];
        }[];
      }) => resource.scopeSpans.flatMap((scope) => scope.spans),
    );
  });
  expect(
    spans.filter(
      (span: {
        attributes: { key: string; value: { stringValue?: string } }[];
      }) =>
        span.attributes.some(
          (attribute) =>
            attribute.key === "url.full" &&
            attribute.value.stringValue?.includes("/api/v1/status"),
        ),
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(spans)).not.toContain("/otel/");
  const payloads = received
    .filter((item) => item.url.includes("/otel/"))
    .map((item) => String(item.init?.body))
    .join("\n");
  expect(payloads).toContain("browser.page_view");
  expect(payloads).toContain("/api/v1/status");
  expect(payloads).not.toMatch(/q=secret|#private/);
  expect(payloads).not.toContain(
    '"url.full","value":{"stringValue":"http://localhost:3000/otel/',
  );
});
