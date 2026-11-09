import { initTelemetry } from "./init";

initTelemetry(
  { VITE_BROWSER_OTLP_URL: import.meta.env.VITE_BROWSER_OTLP_URL, VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL },
  window.location.origin,
);
