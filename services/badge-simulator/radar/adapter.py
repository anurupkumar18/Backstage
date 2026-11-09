"""Answer `POST /internal/radar/diagnose` in mock or radar mode.

mock  : diagnosis from the simulator's own heartbeats and queue, labeled `mock`.
radar : read-only Radar MCP calls against the station's Deployment in the
        configured cluster and namespace. Raw tool results are saved as
        evidence files named by the returned `evidence_refs`. If Radar cannot
        be reached, the answer falls back to mock and says so; it is never
        labeled `radar` without a real Radar result behind it.

Radar output is treated as untrusted evidence: it is truncated, stored and
summarized, never executed or followed.
"""

import json
import logging
import re
import time
from pathlib import Path

from .mcp_client import McpClient, McpError, result_text

log = logging.getLogger("radar.adapter")
MAX_DIAGNOSIS = 2000


def deployment_for(station_id):
    return f"badge-{station_id}"


class RadarDiagnoser:
    def __init__(self, settings, store, clock, evidence_dir, client_factory=None):
        self.settings = settings
        self.store = store
        self.clock = clock
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self._client_factory = client_factory or (
            lambda: McpClient(settings.radar_mcp_url, settings.radar_token)
        )

    def diagnose(self, incident_id, station_id):
        if self.settings.radar_mode == "radar":
            try:
                return self._radar(incident_id, station_id)
            except (McpError, OSError, ValueError) as error:
                log.warning("radar diagnosis failed for %s: %s", station_id, error)
                fallback = self._mock(station_id)
                fallback["diagnosis"] = _clip(f"Radar unavailable ({error}). Local evidence: {fallback['diagnosis']}")
                fallback["evidence_refs"].append("mock-radar-unavailable")
                return fallback
        return self._mock(station_id)

    # Mock mode ------------------------------------------------------------

    def _mock(self, station_id):
        now = self.clock()
        last = self.store.last_heartbeat(station_id)
        pending = self.store.list_jobs(station_id=station_id, status="pending")
        label = station_id.replace("-", " ").title()
        stale = last is None or now - last > self.settings.heartbeat_timeout
        if stale:
            seen = "never sent a heartbeat" if last is None else f"last heartbeat {int(now - last)}s ago"
            diagnosis = f"{label} is offline: {seen}."
            ref = f"mock-{station_id}-offline"
        else:
            diagnosis = f"{label} is online: last heartbeat {int(now - last)}s ago."
            ref = f"mock-{station_id}-online"
        if pending:
            oldest = int(max(now - job["created_at"] for job in pending))
            diagnosis += f" {len(pending)} pending job(s), oldest {oldest}s."
        return {"station_id": station_id, "mode": "mock", "diagnosis": diagnosis, "evidence_refs": [ref]}

    # Radar mode -----------------------------------------------------------

    def _radar(self, incident_id, station_id):
        cluster = self.settings.radar_cluster_id
        if not cluster:
            raise ValueError("RADAR_CLUSTER_ID is not set")
        namespace = self.settings.namespace
        name = deployment_for(station_id)
        client = self._client_factory()
        target = {"cluster": cluster, "namespace": namespace, "kind": "deployment", "name": name}

        resource = client.call_tool("get_resource", {**target, "context": "none"})
        bundle = client.call_tool("diagnose", {**target, "tail_lines": 50, "since": "15m"})

        refs = [
            self._save(incident_id, station_id, "get_resource", resource),
            self._save(incident_id, station_id, "diagnose", bundle),
        ]
        diagnosis = summarize(namespace, name, result_text(resource), result_text(bundle))
        return {"station_id": station_id, "mode": "radar", "diagnosis": diagnosis, "evidence_refs": refs}

    def _save(self, incident_id, station_id, tool, result):
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(self.clock()))
        ref = f"radar-{station_id}-{tool}-{stamp}"[:128]
        record = {"incident_id": incident_id, "station_id": station_id, "tool": tool, "result": result}
        (self.evidence_dir / f"{ref}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        return ref


def summarize(namespace, name, resource_text, bundle_text):
    parts = [f"Radar read deployment {namespace}/{name}."]
    replicas = _replicas(resource_text)
    if replicas:
        ready, desired = replicas
        parts.append(f"Ready replicas {ready}/{desired}.")
        if desired == 0:
            parts.append("The workload is scaled to zero, so the station is not running.")
        elif ready < desired:
            parts.append("The station has no ready pod.")
    reasons = sorted(set(re.findall(r'"reason"\s*:\s*"([A-Za-z]+)"', bundle_text)))
    if reasons:
        parts.append("Event reasons: " + ", ".join(reasons[:6]) + ".")
    headline = re.search(r'"(?:headline|summary)"\s*:\s*"([^"]{1,300})"', bundle_text)
    if headline:
        parts.append(headline.group(1))
    return _clip(" ".join(parts))


def _replicas(text):
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return None
    resource = data.get("resource", data) if isinstance(data, dict) else None
    if not isinstance(resource, dict):
        return None
    spec = resource.get("spec") or {}
    status = resource.get("status") or {}
    if "replicas" not in spec:
        return None
    return int(status.get("readyReplicas") or 0), int(spec["replicas"])


def _clip(text):
    return text if len(text) <= MAX_DIAGNOSIS else text[: MAX_DIAGNOSIS - 1] + "…"
