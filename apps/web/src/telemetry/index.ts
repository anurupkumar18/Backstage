import { initTelemetry } from "./init";

initTelemetry(
  {
    VITE_BROWSER_OTLP_URL: import.meta.env.VITE_BROWSER_OTLP_URL,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_SERVICE_VERSION: import.meta.env.VITE_SERVICE_VERSION,
    VITE_DEPLOYMENT_ENVIRONMENT: import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT,
  },
  window.location.origin,
);
