"""Deliver badge signals to the incident API with stable IDs and retries.

Every signal is queued in an outbox and retried until the API accepts it.
A retry always resends the same signal ID and body, so the API can
deduplicate. Without INCIDENT_API_BASE_URL the outbox only records signals.
"""

import json
import logging
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import tracing

log = logging.getLogger("badge_sim.signals")


def utc_iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def health_signal(source_id, room_id, station_id, status, oldest_age_s, pending_job_ids, run_id, seq, now):
    # run_id changes on every station start and reset, so a fresh outage never
    # reuses an ID the incident API already deduplicated.
    return {
        "schema_version": 1,
        "signal_id": f"{source_id}-badge_health-{station_id}-{run_id}-{seq:04d}",
        "kind": "badge_health",
        "source_id": source_id,
        "room_id": room_id,
        "occurred_at": utc_iso(now),
        "data": {
            "station_id": station_id,
            "status": status,
            "oldest_pending_age_s": int(oldest_age_s),
            "pending_job_ids": list(pending_job_ids),
        },
    }


def completion_signal(station_id, room_id, job_id, run_id, pdf_ref, now):
    # One signal ID per logical job run: retries and failover reuse it, while
    # re-seeding the same job ID after a reset gets a new run_id.
    return {
        "schema_version": 1,
        "signal_id": f"badge_job_complete-{job_id}-{run_id}",
        "kind": "badge_job_complete",
        "source_id": station_id,
        "room_id": room_id,
        "occurred_at": utc_iso(now),
        "data": {"station_id": station_id, "job_id": job_id, "pdf_ref": pdf_ref},
    }


class SignalOutbox:
    def __init__(self, base_url="", token="", retry_seconds=1.0, timeout=5.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.retry_seconds = retry_seconds
        self.timeout = timeout
        self._lock = threading.Condition()
        self._pending = {}
        self.delivered = {}
        self.rejected = {}
        self.recorded = []
        self._stop = threading.Event()
        self._thread = None

    def emit(self, signal):
        with self._lock:
            sid = signal["signal_id"]
            self.recorded.append(signal)
            if sid in self.delivered or sid in self.rejected or sid in self._pending:
                return
            self._pending[sid] = (signal, tracing.inject({}))
            self._lock.notify()

    def reset(self):
        """Forget every signal, including undelivered ones (rehearsal reset only)."""
        with self._lock:
            self._pending.clear()
            self.delivered.clear()
            self.rejected.clear()
            self.recorded.clear()

    def pending_count(self):
        with self._lock:
            return len(self._pending)

    def start(self):
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="signal-outbox", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        with self._lock:
            self._lock.notify_all()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        while not self._stop.is_set():
            with self._lock:
                if not self._pending:
                    self._lock.wait(timeout=self.retry_seconds)
                batch = list(self._pending.items())
            failed = False
            for sid, (signal, headers) in batch:
                outcome = self._deliver(signal, headers)
                if outcome == "retry":
                    failed = True
                    continue
                with self._lock:
                    self._pending.pop(sid, None)
                    (self.delivered if outcome == "ok" else self.rejected)[sid] = signal
            if failed:
                self._stop.wait(self.retry_seconds)

    def _deliver(self, signal, trace_headers):
        if not self.base_url:
            return "ok"  # recording mode
        headers = {"Content-Type": "application/json", **trace_headers}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            f"{self.base_url}/signals", data=json.dumps(signal).encode(), headers=headers, method="POST"
        )
        try:
            with urlopen(request, timeout=self.timeout):
                return "ok"
        except HTTPError as error:
            if error.code in (400, 401, 403, 409, 422):
                # Permanent: retrying the same body cannot succeed. Keep it visible.
                log.error("signal %s rejected with %s: %s", signal["signal_id"], error.code, error.read()[:500])
                return "rejected"
            log.warning("signal %s got %s, will retry", signal["signal_id"], error.code)
        except (URLError, OSError) as error:
            log.warning("signal %s not delivered (%s), will retry", signal["signal_id"], error)
        return "retry"


def wait_until(predicate, timeout, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()
