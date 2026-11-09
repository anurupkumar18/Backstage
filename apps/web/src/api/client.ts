import type {
  EvidencePage,
  EvidenceQuery,
  IncidentDiagnostics,
} from "../diagnostics/types";
import type {
  Action,
  ApiErrorCode,
  ApiResult,
  EventsPage,
  Incident,
  IncidentsPage,
  PublicStatus,
} from "./types";
import type { Transport } from "./transport";

export interface ActionIntent {
  incidentId: string;
  key: string;
  body: Action;
}

export interface ClientOptions {
  transport: Transport;
  getToken: () => string;
  /** Extra attempts after a thrown network error. Retries reuse the same Idempotency-Key and body. */
  maxRetries?: number;
}

const KNOWN_CODES: readonly ApiErrorCode[] = [
  "unauthorized",
  "forbidden",
  "not_found",
  "stale_version",
  "invalid_transition",
  "reservation_conflict",
  "idempotency_conflict",
  "invalid_payload",
  "unavailable",
  "evidence_unavailable",
];

const FALLBACK_BY_STATUS: Record<number, ApiErrorCode> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "invalid_transition",
  422: "invalid_payload",
  503: "unavailable",
};

export function newIntent(incidentId: string, body: Action): ActionIntent {
  return {
    incidentId,
    body,
    key: `${body.action}-${incidentId}-${crypto.randomUUID()}`,
  };
}

export function sameBody(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseError(
  status: number,
  json: unknown,
): { code: ApiErrorCode; message: string } {
  const error = (
    json as { error?: { code?: unknown; message?: unknown } } | null
  )?.error;
  const code =
    KNOWN_CODES.find((known) => known === error?.code) ??
    FALLBACK_BY_STATUS[status] ??
    "unavailable";
  const message =
    typeof error?.message === "string"
      ? error.message
      : `Request failed with status ${status}.`;
  return { code, message };
}

export function createClient({
  transport,
  getToken,
  maxRetries = 2,
}: ClientOptions) {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      retry?: boolean;
    } = {},
  ): Promise<ApiResult<T>> {
    const headers = {
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    };
    const attempts = options.retry === false ? 1 : maxRetries + 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await transport({
          method,
          path,
          headers,
          body: options.body,
          signal: options.signal,
        });
        if (response.status >= 200 && response.status < 300) {
          return { ok: true, data: response.json as T };
        }
        return {
          ok: false,
          status: response.status,
          ...parseError(response.status, response.json),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (attempt >= attempts) {
          return {
            ok: false,
            status: 0,
            code: "network",
            message:
              "Could not reach the incident API. Check the connection and try again.",
          };
        }
      }
    }
  }

  return {
    getStatus: (signal?: AbortSignal) =>
      request<PublicStatus>("GET", "/status", { signal }),
    listIncidents: (signal?: AbortSignal) =>
      request<IncidentsPage>("GET", "/incidents", { signal }),
    getIncident: (id: string, signal?: AbortSignal) =>
      request<Incident>("GET", `/incidents/${encodeURIComponent(id)}`, {
        signal,
      }),
    listEvents: (id: string, signal?: AbortSignal) =>
      request<EventsPage>(
        "GET",
        `/incidents/${encodeURIComponent(id)}/events`,
        { signal },
      ),
    getDiagnostics: (id: string, signal?: AbortSignal) =>
      request<IncidentDiagnostics>(
        "GET",
        `/incidents/${encodeURIComponent(id)}/diagnostics`,
        { signal },
      ),
    searchEvidence: (query: EvidenceQuery, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      return request<EvidencePage>("GET", `/evidence/search?${params}`, {
        signal,
      });
    },
    applyAction: (intent: ActionIntent, signal?: AbortSignal) =>
      request<Incident>(
        "POST",
        `/incidents/${encodeURIComponent(intent.incidentId)}/actions`,
        {
          body: intent.body,
          headers: { "Idempotency-Key": intent.key },
          signal,
        },
      ),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
