import examples from "@fixtures/http.examples.json";
import overflowSignalsRaw from "@fixtures/overflow.signals.jsonl?raw";
import type {
  Action,
  AllowedAction,
  Assignment,
  EventType,
  EventsPage,
  Incident,
  IncidentState,
  IncidentsPage,
  ProtocolEvent,
  PublicStatus,
} from "../api/types";

export interface Principal {
  id: string;
  tier: 0 | 1 | 2 | 3;
}

export interface MockRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface MockResponse {
  status: number;
  json: unknown;
}

interface FixtureExample {
  scenario: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
  request?: unknown;
}

interface Signal {
  signal_id: string;
  occurred_at: string;
  data: { zone: string; count: number; threshold: number };
}

export interface MockOptions {
  principals: Record<string, Principal>;
  now?: () => Date;
  dispatchDelayMs?: number;
  /** Real milliseconds between clearing-replay samples. */
  tickMs?: number;
}

const SCENARIO = "overflow";
const INCIDENT_ID = "inc-overflow-room-b";
const VERIFY_WINDOW_MS = 60_000;

const fixtures = examples as unknown as FixtureExample[];

function fixture(method: string, path: string, status = 200): FixtureExample {
  const found = fixtures.find(
    (example) =>
      example.scenario === SCENARIO && example.method === method && example.path === path && example.status === status,
  );
  if (!found) {
    throw new Error(`Missing shared fixture ${method} ${path} ${status}`);
  }
  return found;
}

function fixtureErrorMessage(status: number): string {
  const found = fixtures.find(
    (example) => example.scenario === SCENARIO && example.method === "POST" && example.status === status,
  );
  return (found?.response as { error: { message: string } }).error.message;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorResponse(status: number, code: string, message: string): MockResponse {
  return { status, json: { error: { code, message } } };
}

export class NetworkDropped extends TypeError {
  constructor() {
    super("Mock network drop after commit");
  }
}

export class MockIncidentApi {
  private readonly options: Required<Omit<MockOptions, "principals">> & Pick<MockOptions, "principals">;
  private incident!: Incident;
  private events!: ProtocolEvent[];
  private idempotency = new Map<string, { hash: string; response: MockResponse }>();
  private observed: Signal[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private dropNext = false;
  private readonly clearingSignals: Signal[];

  constructor(options: MockOptions) {
    this.options = {
      now: () => new Date(),
      dispatchDelayMs: 1200,
      tickMs: 1500,
      ...options,
    };
    this.clearingSignals = overflowSignalsRaw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Signal)
      .filter((signal) => signal.data.zone === "door" && signal.data.count < signal.data.threshold);
    this.seed();
  }

  reset(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.idempotency.clear();
    this.observed = [];
    this.dropNext = false;
    this.seed();
  }

  /** Rehearsal control: another operator changed the incident, so the next approve or ack is stale. */
  bumpVersion(): void {
    this.incident.version += 1;
    this.incident.updated_at = this.timestamp();
  }

  /** Rehearsal control: the next POST commits, then the response is lost. */
  dropNextResponse(): void {
    this.dropNext = true;
  }

  handle(request: MockRequest): MockResponse {
    const principal = this.authenticate(request.headers);
    if (!principal) {
      return errorResponse(401, "unauthorized", "A valid token is required.");
    }
    const path = request.path.split("?")[0] ?? request.path;

    if (request.method === "GET" && path === "/status") {
      return { status: 200, json: this.publicStatus() };
    }
    if (principal.tier < 1) {
      return errorResponse(403, "forbidden", "Incident access requires staff or organizer scope.");
    }
    if (request.method === "GET" && path === "/incidents") {
      const page: IncidentsPage = { items: [this.view(principal)], next_cursor: null };
      return { status: 200, json: page };
    }
    const match = /^\/incidents\/([^/]+)(\/events|\/actions)?$/.exec(path);
    if (!match || decodeURIComponent(match[1] ?? "") !== INCIDENT_ID) {
      return errorResponse(404, "not_found", "Incident not found.");
    }
    const suffix = match[2];
    if (request.method === "GET" && !suffix) {
      return { status: 200, json: this.view(principal) };
    }
    if (request.method === "GET" && suffix === "/events") {
      const page: EventsPage = { items: clone(this.events), next_cursor: null };
      return { status: 200, json: page };
    }
    if (request.method === "POST" && suffix === "/actions") {
      const response = this.applyAction(principal, request);
      if (this.dropNext) {
        this.dropNext = false;
        throw new NetworkDropped();
      }
      return response;
    }
    return errorResponse(404, "not_found", "Route not found.");
  }

  private seed(): void {
    this.incident = clone(fixture("GET", `/api/v1/incidents/${INCIDENT_ID}`).response as Incident);
    this.events = clone((fixture("GET", `/api/v1/incidents/${INCIDENT_ID}/events`).response as EventsPage).items);
  }

  private authenticate(headers: Record<string, string>): Principal | null {
    const token = /^Bearer (.+)$/.exec(headers.Authorization ?? "")?.[1];
    return (token && this.options.principals[token]) || null;
  }

  private timestamp(): string {
    return this.options.now().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private view(principal: Principal): Incident {
    const view = clone(this.incident);
    const isAssignee = view.assignment?.assignee_id === principal.id;
    const allowed: AllowedAction[] = [];
    if (principal.tier === 3 && view.state === "plan_proposed") {
      allowed.push("approve");
    }
    if (isAssignee && view.state === "dispatched") {
      allowed.push("ack");
    }
    if (isAssignee && (view.state === "dispatched" || view.state === "accepted")) {
      allowed.push("handoff");
    }
    view.allowed_actions = allowed;
    return view;
  }

  private publicStatus(): PublicStatus {
    const status = clone(fixture("GET", "/api/v1/status").response as PublicStatus);
    const state = this.incident.state;
    const roomStatus = state === "resolved" ? "normal" : state === "verifying" ? "recovering" : "affected";
    status.rooms = status.rooms.map((room) => (room.room_id === this.incident.room_id ? { ...room, status: roomStatus } : room));
    return status;
  }

  private applyAction(principal: Principal, request: MockRequest): MockResponse {
    const key = request.headers["Idempotency-Key"];
    if (!key) {
      return errorResponse(422, "invalid_payload", "Idempotency-Key header is required.");
    }
    const hash = stableStringify({ path: request.path, body: request.body });
    const cached = this.idempotency.get(`${principal.id}:${key}`);
    if (cached) {
      return cached.hash === hash
        ? clone(cached.response)
        : errorResponse(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    const body = request.body as Action | undefined;
    if (!body || typeof body.expected_version !== "number" || !body.payload) {
      return errorResponse(422, "invalid_payload", "Action body does not match the contract.");
    }

    const outcome = this.executeAction(principal, body);
    if (outcome.status === 200) {
      this.idempotency.set(`${principal.id}:${key}`, { hash, response: clone(outcome) });
    }
    return outcome;
  }

  private executeAction(principal: Principal, body: Action): MockResponse {
    if (body.action === "approve") {
      if (principal.tier < 3) {
        return errorResponse(403, "forbidden", fixtureErrorMessage(403));
      }
    } else if (body.action === "ack" || body.action === "handoff") {
      if (this.incident.assignment?.assignee_id !== principal.id) {
        return errorResponse(403, "forbidden", "Only the assigned staff member can respond to this assignment.");
      }
    } else {
      return errorResponse(422, "invalid_payload", "Unknown action.");
    }

    if (body.expected_version !== this.incident.version) {
      return errorResponse(409, "stale_version", fixtureErrorMessage(409));
    }

    if (body.action === "approve") {
      if (this.incident.state !== "plan_proposed") {
        return errorResponse(409, "invalid_transition", "The plan is no longer awaiting approval.");
      }
      if (body.payload.plan_id !== this.incident.plan?.id) {
        return errorResponse(422, "invalid_payload", "plan_id does not match the proposed plan.");
      }
      this.transition("approve", "approved", { id: principal.id, kind: "human", tier: principal.tier }, {
        plan_id: body.payload.plan_id,
      });
      this.schedule(this.options.dispatchDelayMs, () => this.dispatch());
      return { status: 200, json: this.view(principal) };
    }

    if (body.action === "ack") {
      if (this.incident.state !== "dispatched") {
        return errorResponse(409, "invalid_transition", "The assignment is not awaiting a response.");
      }
      if (body.payload.assignment_id !== this.incident.assignment?.id) {
        return errorResponse(422, "invalid_payload", "assignment_id does not match the active assignment.");
      }
      if (body.payload.decision !== "accepted") {
        return errorResponse(422, "invalid_payload", "Declining is not available in the mock.");
      }
      this.transition("ack", "accepted", { id: principal.id, kind: "human", tier: principal.tier }, {
        assignment_id: body.payload.assignment_id,
        decision: "accepted",
      });
      this.startClearingReplay();
      return { status: 200, json: this.view(principal) };
    }

    return errorResponse(422, "invalid_payload", "Handoff is not available in the mock.");
  }

  private dispatch(): void {
    if (this.incident.state !== "approved") {
      return;
    }
    const assignment = clone(
      (fixture("POST", `/api/v1/incidents/${INCIDENT_ID}/actions`).response as Incident).assignment ??
        ({ id: "assignment-overflow-1", assignee_id: "venue-staff-01", domain: "venue" } as Assignment),
    );
    this.incident.assignment = assignment;
    this.transition("dispatch", "dispatched", { id: "venue-worker", kind: "agent", tier: 2 }, {
      assignment_id: assignment.id,
    });
  }

  private startClearingReplay(): void {
    this.clearingSignals.forEach((signal, index) => {
      this.schedule((index + 1) * this.options.tickMs, () => this.observe(signal));
    });
  }

  private observe(signal: Signal): void {
    if (this.incident.state !== "accepted" && this.incident.state !== "verifying") {
      return;
    }
    this.observed.push(signal);
    const evidence = this.observed.map((item) => item.signal_id);
    const elapsed = this.clearedMs();
    this.incident.verification = {
      status: "pending",
      summary: `Door count has stayed under ${signal.data.threshold} for ${Math.floor(elapsed / 1000)} of ${
        VERIFY_WINDOW_MS / 1000
      } seconds.`,
    };
    this.transition("verify", "verifying", { id: "incident-api", kind: "system", tier: null }, {
      evidence_signal_ids: evidence,
    });
    if (elapsed >= VERIFY_WINDOW_MS) {
      this.incident.verification = {
        status: "passed",
        summary: `Door count stayed under ${signal.data.threshold} for ${VERIFY_WINDOW_MS / 1000} seconds.`,
      };
      this.transition("close", "resolved", { id: "incident-api", kind: "system", tier: null }, {
        evidence_signal_ids: evidence,
      });
    }
  }

  private clearedMs(): number {
    const first = this.observed[0];
    const last = this.observed[this.observed.length - 1];
    if (!first || !last) {
      return 0;
    }
    return Date.parse(last.occurred_at) - Date.parse(first.occurred_at);
  }

  private transition(type: EventType, to: IncidentState, actor: ProtocolEvent["actor"], payload: Record<string, unknown>): void {
    const from = this.incident.state;
    const at = this.timestamp();
    this.incident.state = to;
    this.incident.version += 1;
    this.incident.updated_at = at;
    this.events.push({
      schema_version: 1,
      event_id: `${this.incident.id}-${this.events.length + 1}`,
      incident_id: this.incident.id,
      sequence: this.events.length + 1,
      type,
      occurred_at: at,
      actor,
      state_from: from,
      state_to: to,
      payload,
      trace_id: this.incident.trace_id,
    });
  }

  private schedule(delayMs: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, delayMs);
    this.timers.add(timer);
  }
}
