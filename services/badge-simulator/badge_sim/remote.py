"""Store and artifact clients a station pod uses to reach badge-control.

badge-control owns the queue, heartbeats and PDFs. It stamps heartbeats
with its own clock and reports ages, so station clocks never need to agree.
"""

import json
from urllib.parse import quote
from urllib.request import Request, urlopen

from .store import ArtifactStore, badge_pdf


class ControlClient:
    def __init__(self, base_url, token, timeout=5.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def call(self, method, path, body=None, raw=None, content_type="application/json"):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        headers = {"Authorization": f"Bearer {self.token}"}
        if data is not None:
            headers["Content-Type"] = content_type
        request = Request(self.base_url + path, data=data, headers=headers, method=method)
        with urlopen(request, timeout=self.timeout) as response:
            payload = response.read()
        return json.loads(payload) if payload else {}


class RemoteStore:
    label = "remote"

    def __init__(self, client, clock):
        self.client = client
        self.clock = clock

    def heartbeat(self, station_id):
        self.client.call("POST", f"/internal/stations/{quote(station_id)}/heartbeat", raw=b"")

    def _station(self, station_id, status=None):
        query = f"?status={quote(status)}" if status else ""
        return self.client.call("GET", f"/internal/stations/{quote(station_id)}{query}")

    def last_heartbeat(self, station_id):
        age = self._station(station_id).get("heartbeat_age_s")
        return None if age is None else self.clock() - age

    def list_jobs(self, station_id=None, status=None):
        now = self.clock()
        jobs = self._station(station_id, status)["jobs"]
        for job in jobs:
            job["created_at"] = now - job.pop("age_s")
        return jobs

    def complete_job(self, job_id, station_id, pdf_ref):
        path = f"/internal/stations/{quote(station_id)}/jobs/{quote(job_id)}/complete"
        return self.client.call("POST", path, {"pdf_ref": pdf_ref})["completed"]


class RemoteArtifacts:
    def __init__(self, client):
        self.client = client

    def write(self, job_id, station_id):
        pdf_ref = ArtifactStore.ref_for(job_id)
        self.client.call("PUT", f"/internal/pdfs/{quote(pdf_ref)}", raw=badge_pdf(job_id, station_id),
                         content_type="application/pdf")
        return pdf_ref
