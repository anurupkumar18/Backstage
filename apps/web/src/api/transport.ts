export interface TransportRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  json: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export function fetchTransport(baseUrl: string): Transport {
  return async ({ method, path, headers, body, signal }) => {
    const hasBody = body !== undefined;
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };
}
