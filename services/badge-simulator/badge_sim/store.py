"""Badge job queue, station heartbeats, idempotency records and PDF artifacts.

`MemoryStore` is the labeled local fake. The in-cluster store will implement
the same methods against a simulator-owned Elasticsearch index.
"""

import copy
import threading
from pathlib import Path


class JobConflict(Exception):
    """A job cannot move the way the caller asked."""


class MemoryStore:
    label = "mock"

    def __init__(self, clock):
        self._clock = clock
        self._lock = threading.RLock()
        self.reset()

    def reset(self):
        with self._lock:
            self._jobs = {}
            self._heartbeats = {}
            self._idempotency = {}

    # Jobs -----------------------------------------------------------------

    def put_job(self, job_id, station_id):
        """Enqueue a logical job. Re-seeding an existing ID keeps its state."""
        with self._lock:
            if job_id not in self._jobs:
                self._jobs[job_id] = {
                    "job_id": job_id,
                    "station_id": station_id,
                    "status": "pending",
                    "pdf_ref": None,
                    "created_at": self._clock(),
                }
            return copy.deepcopy(self._jobs[job_id])

    def get_job(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            return copy.deepcopy(job) if job else None

    def list_jobs(self, station_id=None, status=None):
        with self._lock:
            return [
                copy.deepcopy(job)
                for job in sorted(self._jobs.values(), key=lambda j: j["job_id"])
                if (station_id is None or job["station_id"] == station_id)
                and (status is None or job["status"] == status)
            ]

    def complete_job(self, job_id, station_id, pdf_ref):
        """Mark a pending job complete. Only its current station may do this."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["station_id"] != station_id or job["status"] != "pending":
                return False
            job["status"] = "complete"
            job["pdf_ref"] = pdf_ref
            return True

    def reassign(self, job_ids, from_station_id, to_station_id):
        """Move pending jobs atomically. Jobs already moved or done are accepted as-is."""
        with self._lock:
            for job_id in job_ids:
                job = self._jobs.get(job_id)
                if job is None:
                    raise JobConflict(f"unknown job {job_id}")
                if job["status"] == "pending" and job["station_id"] not in (from_station_id, to_station_id):
                    raise JobConflict(f"{job_id} is queued at {job['station_id']}, not {from_station_id}")
            for job_id in job_ids:
                job = self._jobs[job_id]
                if job["status"] == "pending":
                    job["station_id"] = to_station_id
            return list(job_ids)

    # Station health -------------------------------------------------------

    def heartbeat(self, station_id):
        with self._lock:
            self._heartbeats[station_id] = self._clock()

    def last_heartbeat(self, station_id):
        with self._lock:
            return self._heartbeats.get(station_id)

    # Idempotency ----------------------------------------------------------

    def remember(self, scope, key, fingerprint, response):
        """Store the first response for a key; return the stored record."""
        with self._lock:
            record = self._idempotency.setdefault((scope, key), (fingerprint, response))
            return record

    def recall(self, scope, key):
        with self._lock:
            return self._idempotency.get((scope, key))


class ArtifactStore:
    """Badge PDFs addressed by a stable reference. Holds no attendee data."""

    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def ref_for(job_id):
        return f"pdf-{job_id}"

    def path(self, pdf_ref):
        return self.directory / f"{pdf_ref}.pdf"

    def exists(self, pdf_ref):
        return self.path(pdf_ref).is_file()

    def write(self, job_id, station_id):
        """Write the PDF once. A retry or failover reuses the same file and reference."""
        pdf_ref = self.ref_for(job_id)
        target = self.path(pdf_ref)
        if not target.is_file():
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(_badge_pdf(f"Backstage badge {job_id} printed at {station_id}"))
            tmp.replace(target)
        return pdf_ref


def _badge_pdf(text):
    """Build a minimal single-page PDF with one line of text."""
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 18 Tf 36 100 Td ({safe}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 216] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)
