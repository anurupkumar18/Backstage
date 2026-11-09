"""Room C badge recovery and the scoped badge-control client."""

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from urllib.error import URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from jsonschema import Draft202012Validator
from opentelemetry.context import Context

STATION_A = "station-a"
STATION_B = "station-b"
BADGE_ROOM = "room-c"
BADGE_KINDS = {"badge_health", "badge_job_complete"}
BADGE_HEALTH_MAX_AGE = timedelta(seconds=60)
IT = {"id": "it-worker", "kind": "agent", "tier": 2}


@dataclass
class BadgeRecovery:
    job_ids: list[str]
    diagnosis: dict | None = None
    rerouted: bool = False
    completions: dict = field(default_factory=dict)


def has_outage(signal, age):
    data = signal["data"]
    return (
        signal["kind"] == "badge_health"
        and age <= BADGE_HEALTH_MAX_AGE
        and signal["source_id"] == STATION_B
        and data["station_id"] == STATION_A
        and data["status"] == "offline"
        and data["oldest_pending_age_s"] > 0
        and bool(data["pending_job_ids"])
    )


def observe_completion(incident, signal, at):
    data = signal["data"]
    if (
        incident.state != "verifying"
        or signal["kind"] != "badge_job_complete"
        or at < incident.accepted_at.replace(microsecond=0)
        or signal["source_id"] != STATION_B
        or data["station_id"] != STATION_B
        or data["job_id"] not in incident.badge.job_ids
    ):
        return

    job_id = data["job_id"]
    previous = incident.badge.completions.get(job_id)
    if previous is None or at >= datetime.fromisoformat(previous["occurred_at"]):
        incident.badge.completions[job_id] = {
            "signal_id": signal["signal_id"],
            "pdf_ref": data["pdf_ref"],
            "occurred_at": signal["occurred_at"],
        }


@dataclass(frozen=True)
class BadgeCommand:
    incident_id: str
    trace_context: Context
    operation: str
    job_ids: tuple[str, ...] = ()
    proofs: tuple[tuple[str, str, str], ...] = ()


def completion_proofs(badge):
    if not all(job_id in badge.completions for job_id in badge.job_ids):
        return ()
    return tuple(
        (job_id, badge.completions[job_id]["signal_id"], badge.completions[job_id]["pdf_ref"])
        for job_id in badge.job_ids
    )


def next_command(store):
    for incident in store.active.values():
        if incident.badge is None:
            continue
        if incident.state == "triaged":
            return BadgeCommand(incident.id, incident.trace_context, "diagnose")
        if incident.state == "verifying":
            if not incident.badge.rerouted:
                return BadgeCommand(incident.id, incident.trace_context, "reroute", tuple(incident.badge.job_ids))
            if proofs := completion_proofs(incident.badge):
                return BadgeCommand(incident.id, incident.trace_context, "verify", proofs=proofs)
    return None


def apply_result(store, command, result, now):
    incident = store.incidents[command.incident_id]
    badge = incident.badge
    if command.operation == "diagnose" and incident.state == "triaged":
        badge.diagnosis = result
        incident.plan = {
            "id": f"plan-{incident.id}-1",
            "summary": (
                f"Reroute {len(badge.job_ids)} badge jobs from Station A to Station B. "
                f"Diagnosis ({result['mode']}): {result['diagnosis'][:1000]}"
            ),
        }
        store.transition(incident, "propose", IT, {"plan_id": incident.plan["id"]}, now)
    elif incident.state == "verifying":
        if command.operation == "reroute" and not badge.rerouted:
            badge.rerouted = True
            store.mutation_count += 1
        elif command.operation == "verify" and result and badge.rerouted:
            if command.proofs == completion_proofs(badge):
                store.close(incident, [signal_id for _, signal_id, _ in command.proofs], now)


class BadgeUnavailable(Exception):
    """Badge control was unavailable or did not confirm the requested operation."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BadgeControl:
    def __init__(self, base_url, token, schema):
        url = urlsplit(base_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
        ):
            raise ValueError("BADGE_SERVICE_URL must be the badge-control origin.")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.validators = {
            name: Draft202012Validator(schema["$defs"][name])
            for name in ("diagnose_response", "reroute_response", "job_status")
        }

    def request(self, path, response_schema, *, body=None, key=None):
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if key is not None:
            headers["Idempotency-Key"] = key
        request = Request(
            self.base_url + path, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            with self.opener.open(request, timeout=3) as response:
                expected_status = 202 if response_schema == "reroute_response" else 200
                if response.status != expected_status:
                    raise BadgeUnavailable()
                result = json.load(response)
        except (URLError, OSError, ValueError) as error:
            raise BadgeUnavailable() from error
        if not self.validators[response_schema].is_valid(result):
            raise BadgeUnavailable()
        return result

    def execute(self, command):
        if command.operation == "diagnose":
            diagnosis = self.request(
                "/internal/radar/diagnose", "diagnose_response",
                body={"incident_id": command.incident_id, "station_id": STATION_A},
            )
            if diagnosis["station_id"] != STATION_A:
                raise BadgeUnavailable()
            return diagnosis

        if command.operation == "reroute":
            result = self.request(
                "/internal/badges/reroute", "reroute_response", key=f"{command.incident_id}-reroute",
                body={
                    "incident_id": command.incident_id,
                    "from_station_id": STATION_A,
                    "to_station_id": STATION_B,
                    "job_ids": list(command.job_ids),
                },
            )
            if set(result["accepted_job_ids"]) != set(command.job_ids):
                raise BadgeUnavailable()
            return True

        if command.operation != "verify":
            raise ValueError("Unknown badge command.")
        for job_id, _, pdf_ref in command.proofs:
            job = self.request(f"/internal/badges/jobs/{quote(job_id, safe='')}", "job_status")
            if (
                job["job_id"] != job_id
                or job["station_id"] != STATION_B
                or job["status"] != "complete"
                or job["pdf_ref"] != pdf_ref
            ):
                return False
        return True
