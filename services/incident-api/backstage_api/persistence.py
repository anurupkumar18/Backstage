"""Versioned Elasticsearch checkpoint for the single-writer overflow demo."""

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from threading import Lock
from contextlib import nullcontext

from elasticsearch import ApiError as ElasticsearchError
from elasticsearch import ConflictError, NotFoundError, TransportError
from opentelemetry.trace import Link, NonRecordingSpan, SpanContext, TraceFlags, get_current_span, set_span_in_context

from .badges import BadgeRecovery
from .engine import ApiError, Incident, IncidentStore, RoomEvidence, timestamp

DOCUMENT_ID = "overflow-demo"
SCHEMA_VERSION = 1


class CheckpointConflict(Exception):
    """Another write changed the checkpoint since it was loaded."""


def unavailable():
    return ApiError(503, "unavailable", "The incident store is temporarily unavailable.")


def parse_time(value):
    return datetime.fromisoformat(value) if value is not None else None


def incident_record(incident):
    span = get_current_span(incident.trace_context).get_span_context()
    return {
        "id": incident.id,
        "room_id": incident.room_id,
        "session_id": incident.session_id,
        "trace_id": incident.trace_id,
        "span_id": f"{span.span_id:016x}",
        "trace_flags": int(span.trace_flags),
        "state": incident.state,
        "updated_at": timestamp(incident.updated_at),
        "plan": incident.plan,
        "assignment": incident.assignment,
        "ack_deadline": timestamp(incident.ack_deadline) if incident.ack_deadline else None,
        "accepted_at": timestamp(incident.accepted_at) if incident.accepted_at else None,
        "attempted_staff": sorted(incident.attempted_staff),
        "events": incident.events,
        "clear_samples": [[timestamp(at), signal_id] for at, signal_id in incident.clear_samples],
        "badge": asdict(incident.badge) if incident.badge is not None else None,
    }


def restore_incident(record):
    fields = dict(record)
    span = SpanContext(
        trace_id=int(fields["trace_id"], 16),
        span_id=int(fields.pop("span_id"), 16),
        is_remote=True,
        trace_flags=TraceFlags(fields.pop("trace_flags")),
    )
    for name in ("updated_at", "ack_deadline", "accepted_at"):
        fields[name] = parse_time(fields[name])
    fields["attempted_staff"] = set(fields["attempted_staff"])
    fields["clear_samples"] = [(parse_time(at), signal_id) for at, signal_id in fields["clear_samples"]]
    if fields.get("badge") is not None:
        fields["badge"] = BadgeRecovery(**fields["badge"])
    return Incident(**fields, trace_context=set_span_in_context(NonRecordingSpan(span)))


def checkpoint_document(store):
    return {
        "schema_version": SCHEMA_VERSION,
        "state": {
            "incidents": [incident_record(incident) for incident in store.incidents.values()],
            "active": {room_id: incident.id for room_id, incident in store.active.items()},
            "room_evidence": {
                room_id: {
                    field: timestamp(at) if at is not None else None for field, at in asdict(evidence).items()
                }
                for room_id, evidence in store.room_evidence.items()
            },
            "signals": {
                signal_id: [body, timestamp(received_at), incident_id]
                for signal_id, (body, received_at, incident_id) in store.signals.items()
            },
            "action_receipts": [
                {"scope": list(scope), "body": body, "result": result}
                for scope, (body, result) in store.action_receipts.items()
            ],
        },
    }


def restore_store(tracer, document):
    if document["schema_version"] != SCHEMA_VERSION:
        raise ValueError("Unsupported checkpoint schema.")
    state = document["state"]
    store = IncidentStore(tracer)
    for record in state["incidents"]:
        incident = restore_incident(record)
        store.incidents[incident.id] = incident
    store.active = {room_id: store.incidents[incident_id] for room_id, incident_id in state["active"].items()}
    store.room_evidence = {
        room_id: RoomEvidence(**{field: parse_time(at) for field, at in evidence.items()})
        for room_id, evidence in state["room_evidence"].items()
    }
    store.signals = {
        signal_id: (body, parse_time(received_at), incident_id)
        for signal_id, (body, received_at, incident_id) in state["signals"].items()
    }
    store.action_receipts = {
        tuple(receipt["scope"]): (receipt["body"], receipt["result"])
        for receipt in state["action_receipts"]
    }
    return store


class ElasticsearchCheckpoint:
    def __init__(self, client, alias):
        self.client = client
        self.alias = alias
        self.telemetry = None

    def _get(self, *, source):
        with self.telemetry.es_operation("load") if self.telemetry else nullcontext():
            try:
                return self.client.get(index=self.alias, id=DOCUMENT_ID, source=source)
            except NotFoundError as error:
                # An empty, provisioned checkpoint is a healthy initial state.
                # Classify its expected missing-document response before telemetry ends.
                if isinstance(error.body, dict) and error.body.get("found") is False:
                    return None
                raise unavailable() from error
            except (ElasticsearchError, TransportError) as error:
                raise unavailable() from error

    def check(self):
        self._get(source=False)

    def load(self, tracer):
        result = self._get(source=True)
        if result is None:
            return IncidentStore(tracer), None
        try:
            return restore_store(tracer, result["_source"]), (result["_seq_no"], result["_primary_term"])
        except (KeyError, TypeError, ValueError) as error:
            raise unavailable() from error

    def save(self, store, revision):
        if revision is None:
            condition = {"op_type": "create"}
        else:
            seq_no, primary_term = revision
            condition = {"if_seq_no": seq_no, "if_primary_term": primary_term}
        try:
            with self.telemetry.es_operation("save") if self.telemetry else nullcontext():
                response = self.client.index(
                    index=self.alias,
                    id=DOCUMENT_ID,
                    document=checkpoint_document(store),
                    require_alias=True,
                    include_source_on_error=False,
                    **condition,
                )
            return response["_seq_no"], response["_primary_term"]
        except ConflictError as error:
            raise CheckpointConflict() from error
        except (ElasticsearchError, TransportError, KeyError, TypeError) as error:
            raise unavailable() from error

    def close(self):
        self.client.close()


@dataclass(frozen=True)
class CommittedSnapshot:
    """Owned immutable copy; projection cannot observe an in-flight transaction."""
    document_json: str
    revision: tuple | None

    def document(self):
        return json.loads(self.document_json)


class IncidentRuntime:
    """Serialize commands and publish changes only after durable acknowledgement."""

    def __init__(self, tracer, checkpoint=None, telemetry=None):
        self.tracer = tracer
        self.telemetry = telemetry
        self.checkpoint = checkpoint
        self.lock = Lock()
        self.store = IncidentStore(tracer) if checkpoint is None else None
        self.revision = None
        self.committed = None

    def _publish(self):
        self.committed = CommittedSnapshot(json.dumps(checkpoint_document(self.store), sort_keys=True), self.revision)

    def snapshot(self):
        with self.lock:
            self._load()
            if self.committed is None:
                self._publish()
            return self.committed

    def _load(self):
        if self.store is None:
            self.store, self.revision = self.checkpoint.load(self.tracer)
            self._publish()

    def check(self):
        if self.checkpoint is not None:
            with self.lock:
                if self.store is None:
                    self._load()
                else:
                    self.checkpoint.check()

    def run(self, operation):
        with self.lock:
            for _ in range(2):
                self._load()
                before = self.store.mutation_count
                sequences = {key: len(item.events) for key, item in self.store.incidents.items()}
                try:
                    result = operation(self.store)
                except Exception:
                    if self.checkpoint is not None and self.store.mutation_count != before:
                        self.store = None
                    raise

                if self.store.mutation_count == before:
                    return result
                if self.checkpoint is None:
                    self._publish()
                    self._committed_events(sequences)
                    return result

                try:
                    self.revision = self.checkpoint.save(self.store, self.revision)
                except CheckpointConflict:
                    self.store = None
                    continue
                except ApiError:
                    # A transport failure can occur after the write reached Elasticsearch.
                    # Reload before serving reads or applying the caller's retry.
                    self.store = None
                    raise
                self._publish()
                self._committed_events(sequences)
                return result
            raise unavailable()

    def _committed_events(self, sequences):
        request_context = get_current_span().get_span_context()
        links = [Link(request_context)] if request_context.is_valid else []
        for incident in self.store.incidents.values():
            for event in incident.events[sequences.get(incident.id, 0):]:
                attributes = {"incident.id": incident.id, "incident.event.id": event["event_id"],
                              "incident.event.type": event["type"], "incident.state": event["state_to"],
                              "storage.mode": "memory" if self.checkpoint is None else "elasticsearch"}
                with self.tracer.start_as_current_span("incident.transition", context=incident.trace_context,
                                                       links=links, attributes=attributes):
                    if self.telemetry:
                        self.telemetry.count("backstage.incident.transitions", {
                            "event.type": event["type"], "state": event["state_to"],
                            "storage.mode": attributes["storage.mode"]})
                        self.telemetry.event("incident.transition.committed", incident_id=incident.id,
                                             event_id=event["event_id"], event_type=event["type"],
                                             state=event["state_to"], storage_mode=attributes["storage.mode"])

    def close(self):
        if self.checkpoint is not None:
            with self.lock:
                self.checkpoint.close()
