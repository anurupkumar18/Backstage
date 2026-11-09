"""Incident lifecycle and count evidence for the Room B demo."""

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

from opentelemetry.context import Context
from opentelemetry.trace import set_span_in_context

from .badges import IT, BadgeRecovery, has_outage, observe_completion

MAX_DOOR_GAP = timedelta(seconds=20)
SEATING_MAX_AGE = timedelta(seconds=60)
TRIGGER_DURATION = timedelta(seconds=30)
CLEAR_DURATION = timedelta(seconds=60)
ACK_TIMEOUT = timedelta(seconds=60)

SYSTEM = {"id": "incident-api", "kind": "system", "tier": None}
VENUE = {"id": "venue-worker", "kind": "agent", "tier": 2}
ROSTERS = {
    "venue": (("venue-staff-01", 10), ("venue-staff-02", 20)),
    "it": (("it-staff-01", 10), ("it-staff-02", 20)),
}
TRANSITIONS = {
    "raise": ({None}, "detected"),
    "claim": ({"detected"}, "triaged"),
    "propose": ({"triaged"}, "plan_proposed"),
    "approve": ({"plan_proposed"}, "approved"),
    "dispatch": ({"approved"}, "dispatched"),
    "ack": ({"dispatched"}, "accepted"),
    "handoff": ({"dispatched", "accepted"}, "approved"),
    "verify": ({"accepted"}, "verifying"),
    "close": ({"verifying"}, "resolved"),
    "escalate": ({"approved"}, "escalated"),
}


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def timestamp(when):
    return when.isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class Identity:
    id: str
    tier: Literal[0, 1, 2, 3] | None = None
    domain: str | None = None
    session_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
    room_ids: tuple[str, ...] = ()
    signal_kinds: tuple[str, ...] = ("zone_count",)

    def can_read(self, incident):
        return (
            self.tier == 3
            or (self.tier == 2 and self.domain == incident.domain)
            or (self.tier == 1 and incident.session_id in self.session_ids)
        )

    def audit(self):
        return {"id": self.id, "kind": "human", "tier": self.tier}


@dataclass
class RoomEvidence:
    seating_at: datetime | None = None
    full_since: datetime | None = None
    door_at: datetime | None = None
    overflow_since: datetime | None = None

    def update_seating(self, at, full):
        if self.seating_at is not None and at <= self.seating_at:
            return
        if not full or self.seating_at is None or at - self.seating_at > SEATING_MAX_AGE:
            self.full_since = None
            self.overflow_since = None
        if full and self.full_since is None:
            self.full_since = at
        self.seating_at = at

    def update_door(self, at, over_threshold):
        if self.door_at is not None and at <= self.door_at:
            return False
        if self.door_at is None or at - self.door_at > MAX_DOOR_GAP:
            self.overflow_since = None
        self.door_at = at
        if (
            not over_threshold
            or self.full_since is None
            or at < self.full_since
            or not timedelta(0) <= at - self.seating_at <= SEATING_MAX_AGE
        ):
            self.overflow_since = None
        elif self.overflow_since is None or self.overflow_since < self.full_since:
            self.overflow_since = at
        return True

    def should_open(self, at):
        return self.overflow_since is not None and at - self.overflow_since >= TRIGGER_DURATION


@dataclass
class Incident:
    id: str
    room_id: str
    session_id: str | None
    trace_id: str
    trace_context: Context
    state: str | None = None
    updated_at: datetime | None = None
    plan: dict | None = None
    assignment: dict | None = None
    ack_deadline: datetime | None = None
    accepted_at: datetime | None = None
    attempted_staff: set = field(default_factory=set)
    events: list = field(default_factory=list)
    clear_samples: list = field(default_factory=list)
    badge: BadgeRecovery | None = None

    @property
    def kind(self):
        return "badge_stall" if self.badge is not None else "overflow"

    @property
    def domain(self):
        return "it" if self.badge is not None else "venue"

    @property
    def key(self):
        # Keep the persisted overflow key readable by older checkpoints.
        return f"badge_stall:{self.room_id}" if self.badge is not None else self.room_id

    def allowed_actions(self, actor):
        if self.state == "plan_proposed" and actor.tier == 3:
            return ["approve"]
        assigned = self.assignment is not None and actor.id == self.assignment["assignee_id"]
        staff = actor.tier == 2 and actor.domain == self.domain and assigned
        if self.state == "dispatched" and staff:
            return ["ack", "handoff"]
        if self.state in {"dispatched", "accepted"} and (actor.tier == 3 or staff):
            return ["handoff"]
        return []

    def view(self, actor):
        badge = self.badge is not None
        resolved = self.state == "resolved"
        verified = (
            "Station B completed all affected jobs and confirmed their PDF references."
            if badge else "Door counts stayed below threshold for 60 seconds."
        )
        return {
            "id": self.id,
            "type": self.kind,
            "room_id": self.room_id,
            "session_id": self.session_id,
            "priority": "high",
            "state": self.state,
            "version": len(self.events),
            "updated_at": timestamp(self.updated_at),
            "summary": "Station A badge queue stalled" if badge else f"{self.room_id.replace('-', ' ').title()} overflow",
            "plan": self.plan,
            "assignment": self.assignment,
            "verification": {
                "status": "passed" if resolved else "pending",
                "summary": verified if resolved else None,
            },
            "allowed_actions": self.allowed_actions(actor),
            "trace_id": self.trace_id,
        }


class IncidentStore:
    """Apply lifecycle commands inside a runtime transaction."""

    def __init__(self, tracer):
        self.tracer = tracer
        self.mutation_count = 0
        self.incidents = {}
        self.active = {}
        self.room_evidence = {}
        self.signals = {}
        self.action_receipts = {}

    def transition(self, incident, kind, actor, payload, now):
        origins, destination = TRANSITIONS[kind]
        if incident.state not in origins:
            raise ApiError(409, "invalid_transition", "The incident is no longer in the required state.")
        event_id = f"{incident.id}-{len(incident.events) + 1}"
        with self.tracer.start_as_current_span(
            "incident.transition.attempt",
            context=incident.trace_context,
            attributes={
                "incident.id": incident.id,
                "incident.event.id": event_id,
                "incident.event.type": kind,
                "incident.state": destination,
            },
        ):
            incident.events.append({
                "schema_version": 1,
                "event_id": event_id,
                "incident_id": incident.id,
                "sequence": len(incident.events) + 1,
                "type": kind,
                "occurred_at": timestamp(now),
                "actor": actor,
                "state_from": incident.state,
                "state_to": destination,
                "payload": payload,
                "trace_id": incident.trace_id,
            })
            incident.state = destination
            incident.updated_at = now
            self.mutation_count += 1

    def ingest(self, signal, now):
        signal_id = signal["signal_id"]
        if signal_id in self.signals:
            previous, _, incident_id = self.signals[signal_id]
            if signal != previous:
                raise ApiError(409, "idempotency_conflict", "This signal ID has a different payload.")
            return self.signal_receipt(signal_id, incident_id, deduplicated=True)

        at = datetime.fromisoformat(signal["occurred_at"])
        age = now - at
        count = signal["kind"] == "zone_count"
        if age < timedelta(0) or (count and age > MAX_DOOR_GAP):
            raise ApiError(422, "invalid_payload", "Signal time must be current and cannot be in the future.")

        incident = self.ingest_count(signal, at, now) if count else self.ingest_badge(signal, at, now)
        incident_id = incident.id if incident is not None else None
        self.signals[signal_id] = (signal, now, incident_id)
        self.mutation_count += 1
        return self.signal_receipt(signal_id, incident_id, deduplicated=False)

    def ingest_count(self, signal, at, now):
        room_id = signal["room_id"]
        room = self.room_evidence.setdefault(room_id, RoomEvidence())
        incident = self.active.get(room_id)
        data = signal["data"]
        if data["zone"] == "seating":
            room.update_seating(at, data["count"] >= data["threshold"])
        elif room.update_door(at, data["count"] > data["threshold"]):
            if incident is None and room.should_open(at):
                incident = self.open_incident(signal, now)
            if incident is not None and incident.state in {"accepted", "verifying"}:
                self.observe_recovery(incident, signal, at, now)

        return incident

    def ingest_badge(self, signal, at, now):
        incident = self.active.get(f"badge_stall:{signal['room_id']}")
        if incident is None and has_outage(signal, now - at):
            if any(
                past.badge is not None and past.room_id == signal["room_id"] and past.state == "resolved"
                and at <= past.updated_at.replace(microsecond=0)
                for past in self.incidents.values()
            ):
                return None
            badge = BadgeRecovery(list(signal["data"]["pending_job_ids"]))
            return self.open_incident(signal, now, badge=badge)
        if incident is not None:
            observe_completion(incident, signal, at)
        return incident

    @staticmethod
    def signal_receipt(signal_id, incident_id, *, deduplicated):
        return {"signal_id": signal_id, "incident_id": incident_id, "deduplicated": deduplicated}

    def open_incident(self, signal, now, *, badge=None):
        room_id = signal["room_id"]
        kind = "badge-stall" if badge is not None else "overflow"
        incident_id = f"inc-{kind}-{uuid4().hex}"
        room_label = room_id.replace("-", " ").title()
        with self.tracer.start_as_current_span("incident.raise.attempt", attributes={"incident.id": incident_id}) as span:
            incident = Incident(
                id=incident_id,
                room_id=room_id,
                session_id=signal.get("session_id"),
                trace_id=f"{span.get_span_context().trace_id:032x}",
                trace_context=set_span_in_context(span),
                badge=badge,
            )
            self.transition(incident, "raise", SYSTEM, {"signal_id": signal["signal_id"]}, now)
            worker = IT if badge is not None else VENUE
            self.transition(incident, "claim", worker, {"domain": incident.domain}, now)
            if badge is None:
                incident.plan = {
                    "id": f"plan-{incident_id}-1",
                    "summary": f"Send venue staff to {room_label} and hold entry until the door queue clears.",
                }
                self.transition(incident, "propose", VENUE, {"plan_id": incident.plan["id"]}, now)
        self.incidents[incident.id] = self.active[incident.key] = incident
        return incident

    def observe_recovery(self, incident, signal, at, now):
        if at <= incident.accepted_at:
            return
        if incident.state == "accepted":
            self.transition(incident, "verify", SYSTEM, {"evidence_signal_ids": []}, now)
        samples = incident.clear_samples
        data = signal["data"]
        if samples and at - samples[-1][0] > MAX_DOOR_GAP:
            samples.clear()
        if data["count"] >= data["threshold"]:
            samples.clear()
            return
        samples.append((at, signal["signal_id"]))
        if at - samples[0][0] >= CLEAR_DURATION:
            self.close(incident, [signal_id for _, signal_id in samples], now)

    def close(self, incident, signal_ids, now):
        self.transition(incident, "close", SYSTEM, {"evidence_signal_ids": signal_ids}, now)
        del self.active[incident.key]

    def dispatch(self, incident, now):
        loads = Counter(
            item.assignment["assignee_id"] for item in self.active.values() if item.assignment is not None
        )
        candidates = [
            (distance, loads[staff_id], staff_id)
            for staff_id, distance in ROSTERS[incident.domain]
            if staff_id not in incident.attempted_staff
        ]
        if not candidates:
            self.transition(incident, "escalate", SYSTEM, {"reason": f"No eligible {incident.domain} staff remain."}, now)
            return
        _, _, staff_id = min(candidates)
        assignment_id = f"assignment-{incident.id}-{len(incident.attempted_staff) + 1}"
        worker = IT if incident.badge is not None else VENUE
        self.transition(incident, "dispatch", worker, {"assignment_id": assignment_id}, now)
        incident.assignment = {"id": assignment_id, "assignee_id": staff_id, "domain": incident.domain}
        incident.attempted_staff.add(staff_id)
        incident.ack_deadline = now + ACK_TIMEOUT

    def handoff(self, incident, actor, reason, now):
        self.transition(
            incident, "handoff", actor, {"assignment_id": incident.assignment["id"], "reason": reason}, now
        )
        incident.assignment = None
        incident.ack_deadline = None
        incident.accepted_at = None

    def tick(self, now):
        for incident in self.active.values():
            if incident.state == "dispatched" and now >= incident.ack_deadline:
                self.handoff(incident, SYSTEM, "Acknowledgement timed out.", now)
                self.dispatch(incident, now)

    def read(self, incident_id, actor):
        if actor.tier in {None, 0}:
            raise ApiError(403, "forbidden", "Incident access requires an authorized role.")
        incident = self.incidents.get(incident_id)
        if incident is None or not actor.can_read(incident):
            raise ApiError(404, "not_found", "Incident not found.")
        return incident

    def apply_action(self, incident_id, actor, key, body, now):
        incident = self.read(incident_id, actor)
        action = body["action"]
        eligible_tiers = {"approve": {3}, "ack": {2}, "handoff": {2, 3}}
        if actor.tier not in eligible_tiers[action]:
            raise ApiError(403, "forbidden", "This role cannot take that action.")

        scope = (actor.id, incident_id, key)
        if scope in self.action_receipts:
            previous, result = self.action_receipts[scope]
            if body != previous:
                raise ApiError(409, "idempotency_conflict", "This action key has a different payload.")
            return deepcopy(result)

        if action != "approve" and actor.tier == 2 and (
            incident.assignment is None or actor.id != incident.assignment["assignee_id"]
        ):
            raise ApiError(403, "forbidden", "Only the current assignee may take this action.")
        if body["expected_version"] != len(incident.events):
            raise ApiError(409, "stale_version", "Refresh the incident before taking an action.")
        if action not in incident.allowed_actions(actor):
            raise ApiError(409, "invalid_transition", "This action is unavailable in the current state.")
        payload = body["payload"]

        if action == "approve":
            if payload["plan_id"] != incident.plan["id"]:
                raise ApiError(409, "invalid_transition", "The proposed plan does not match.")
            self.transition(incident, "approve", actor.audit(), payload, now)
        else:
            if payload["assignment_id"] != incident.assignment["id"]:
                raise ApiError(409, "invalid_transition", "The current assignment does not match.")
            if action == "ack" and payload["decision"] == "accepted":
                self.transition(incident, "ack", actor.audit(), payload, now)
                incident.accepted_at = now
                incident.ack_deadline = None
            else:
                self.handoff(incident, actor.audit(), payload.get("reason", "Assignment declined."), now)

        result = deepcopy(incident.view(actor))
        self.action_receipts[scope] = (body, result)
        if incident.state == "approved":
            self.dispatch(incident, now)
        elif incident.state == "accepted" and incident.badge is not None:
            self.transition(incident, "verify", SYSTEM, {"evidence_signal_ids": []}, now)
        return deepcopy(result)
