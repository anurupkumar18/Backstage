import { init, reportError, type UrlAttributeRecord } from "@dash0/sdk-web";

export const SERVICE_NAME = "web";
export interface TelemetryEnv {
  VITE_BROWSER_OTLP_URL?: string;
  VITE_API_BASE_URL?: string;
  VITE_SERVICE_VERSION?: string;
  VITE_DEPLOYMENT_ENVIRONMENT?: string;
}
export type TelemetryConfig = Parameters<typeof init>[0];
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Applied by the SDK to page, request, referrer and timing URLs before export. */
export function scrubUrlAttributes(
  attributes: UrlAttributeRecord,
): UrlAttributeRecord {
  const url = new URL(attributes["url.full"]);
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return {
    ...attributes,
    "url.full": url.href,
    "url.query": attributes["url.query"] === undefined ? undefined : "REDACTED",
    "url.fragment":
      attributes["url.fragment"] === undefined ? undefined : "REDACTED",
  };
}

/** Only credential-free, same-origin OTLP proxies are accepted. SDK appends /v1/traces and /v1/logs. */
export function telemetryConfig(
  env: TelemetryEnv,
  origin: string,
): TelemetryConfig | null {
  if (!env.VITE_BROWSER_OTLP_URL?.trim()) return null;
  try {
    const endpoint = new URL(env.VITE_BROWSER_OTLP_URL.trim(), origin);
    if (
      endpoint.origin !== origin ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return null;
    // SDK suppresses every URL prefixed by endpoint.url. Never use the origin itself:
    // that would silently suppress navigation and same-origin API monitoring too.
    endpoint.pathname =
      endpoint.pathname.replace(/\/v1\/traces\/?$/, "").replace(/\/$/, "") ||
      "/otel";
    if (endpoint.pathname !== "/otel") return null;
    const api = new URL(env.VITE_API_BASE_URL?.trim() || "/api/v1", origin);
    const apiPrefix = api.origin + api.pathname.replace(/\/$/, "");
    return {
      serviceName: SERVICE_NAME,
      serviceVersion: env.VITE_SERVICE_VERSION?.trim() || "development",
      environment: env.VITE_DEPLOYMENT_ENVIRONMENT?.trim() || "demo",
      endpoint: { url: endpoint.href.replace(/\/$/, ""), authToken: "" },
      enabledInstrumentations: [
        "@dash0/navigation",
        "@dash0/web-vitals",
        "@dash0/fetch",
        "@dash0/error",
      ],
      headersToCapture: [],
      // Raw exception messages can contain report text or tokens. Only our static summary is allowed.
      ignoreErrorMessages: [/^(?!BACKSTAGE browser error$)/],
      wrapEventHandlers: false,
      wrapTimers: false,
      urlAttributeScrubber: scrubUrlAttributes,
      pageViewInstrumentation: {
        generateMetadata: () => ({ title: "BACKSTAGE" }),
        includeParts: ["HASH"],
        trackVirtualPageViews: true,
      },
      propagators: [
        {
          type: "traceparent",
          match:
            api.origin === origin
              ? []
              : [new RegExp(`^${escapeRegExp(apiPrefix)}(/|$)`)],
        },
      ],
      disableVcsDetection: true,
    };
  } catch {
    return null;
  }
}

let initialized = false;
export function initTelemetry(env: TelemetryEnv, origin: string): boolean {
  if (initialized) return true;
  const config = telemetryConfig(env, origin);
  if (!config) return false;
  try {
    init(config);
    window.addEventListener("error", () =>
      reportError("BACKSTAGE browser error", {
        attributes: { "error.source": "window" },
      }),
    );
    window.addEventListener("unhandledrejection", () =>
      reportError("BACKSTAGE browser error", {
        attributes: { "error.source": "promise" },
      }),
    );
    initialized = true;
    return true;
  } catch {
    return false;
  } // Monitoring must not prevent the board from starting.
}

export function browserMonitoringState(): "configured" | "disabled" {
  return initialized ? "configured" : "disabled";
}
