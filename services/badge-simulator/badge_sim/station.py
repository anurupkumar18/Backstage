"""A badge print station: heartbeats, prints its queue, and watches its peers.

Stopping a station's thread is the local equivalent of its pod going away:
heartbeats stop, its queue stalls, and a surviving station reports the outage.
"""

import logging
import threading

from . import tracing
from .signals import completion_signal, health_signal

log = logging.getLogger("badge_sim.station")


class Station:
    def __init__(self, station_id, settings, store, artifacts, outbox, clock):
        self.station_id = station_id
        self.settings = settings
        self.store = store
        self.artifacts = artifacts
        self.outbox = outbox
        self.clock = clock
        self._stop = threading.Event()
        self._thread = None
        self._peer_state = {}  # peer -> {"offline": bool, "last_report": float, "seq": int}

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        if self.running:
            return
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name=self.station_id, daemon=True)
        self._thread.start()
        log.info("%s online", self.station_id)

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._thread = None
        log.info("%s stopped", self.station_id)

    def _run(self):
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(self.settings.heartbeat_seconds)

    def tick(self):
        """One loop iteration; tests call it directly."""
        self.store.heartbeat(self.station_id)
        for job in self.store.list_jobs(station_id=self.station_id, status="pending"):
            if self._stop.is_set():
                return
            self._print(job["job_id"])
            self.store.heartbeat(self.station_id)
        for peer in self.settings.stations:
            if peer != self.station_id:
                self._watch(peer)

    def _print(self, job_id):
        with tracing.span("badge.print", job_id=job_id, station_id=self.station_id):
            if self._stop.wait(self.settings.print_seconds):
                return
            # The PDF exists before the job reads complete and before the signal goes out.
            pdf_ref = self.artifacts.write(job_id, self.station_id)
            if self.store.complete_job(job_id, self.station_id, pdf_ref):
                self.outbox.emit(
                    completion_signal(self.station_id, self.settings.room_id, job_id, pdf_ref, self.clock())
                )
                log.info("%s completed %s as %s", self.station_id, job_id, pdf_ref)

    def _watch(self, peer):
        now = self.clock()
        last = self.store.last_heartbeat(peer)
        pending = self.store.list_jobs(station_id=peer, status="pending")
        stale = last is None or now - last > self.settings.heartbeat_timeout
        state = self._peer_state.setdefault(peer, {"offline": False, "last_report": None, "seq": 0})
        if stale and pending:
            due = state["last_report"] is None or now - state["last_report"] >= self.settings.health_report_seconds
            if not state["offline"] or due:
                oldest = max(now - job["created_at"] for job in pending)
                self._report(peer, state, "offline", oldest, [job["job_id"] for job in pending], now)
                state["offline"] = True
        elif state["offline"] and not stale:
            self._report(peer, state, "healthy", 0, [job["job_id"] for job in pending], now)
            state["offline"] = False

    def _report(self, peer, state, status, oldest, job_ids, now):
        state["seq"] += 1
        state["last_report"] = now
        self.outbox.emit(
            health_signal(self.station_id, self.settings.room_id, peer, status, oldest, job_ids, state["seq"], now)
        )
        log.info("%s reports %s %s (%d pending)", self.station_id, peer, status, len(job_ids))
