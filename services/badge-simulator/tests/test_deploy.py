"""Checks for deploy/badge and deploy/platform. kubectl is not required."""

import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
SERVICE = ROOT / "services" / "badge-simulator"
BADGE = ROOT / "deploy" / "badge"
PLATFORM = ROOT / "deploy" / "platform"

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fetch_config():
    return yaml.safe_load((BADGE / "badge-fetch-code.yaml").read_text(encoding="utf-8"))["data"]


def source_tarball(extra=()):
    """A tarball shaped like GitHub's codeload archive of this working tree."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path in sorted(SERVICE.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            name = "Backstage-abc123/services/badge-simulator/" + path.relative_to(SERVICE).as_posix()
            data = path.read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        for name, data in extra:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def serve_bytes(data):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@unittest.skipIf(yaml is None, "PyYAML not installed")
class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        kustomization = yaml.safe_load((BADGE / "kustomization.yaml").read_text(encoding="utf-8"))
        cls.docs = []
        for name in kustomization["resources"]:
            cls.docs += [d for d in yaml.safe_load_all((BADGE / name).read_text(encoding="utf-8")) if d]
        cls.by_kind = {}
        for doc in cls.docs:
            cls.by_kind.setdefault(doc["kind"], {})[doc["metadata"]["name"]] = doc

    def test_expected_objects(self):
        self.assertEqual(set(self.by_kind["Deployment"]), {"badge-control", "badge-station-a", "badge-station-b"})
        self.assertEqual(set(self.by_kind["Service"]), {"badge-control"})
        self.assertEqual(set(self.by_kind["ConfigMap"]), {"badge-config", "badge-fetch-code"})
        self.assertNotIn("Secret", self.by_kind, "secrets must never be committed")
        self.assertNotIn("Namespace", self.by_kind, "team-backstage is provisioned by the event")
        self.assertNotIn("Job", self.by_kind, "the drill is run on purpose, not by apply -k")

    def test_selectors_and_service(self):
        for name, deployment in self.by_kind["Deployment"].items():
            selector = deployment["spec"]["selector"]["matchLabels"]
            labels = deployment["spec"]["template"]["metadata"]["labels"]
            self.assertLessEqual(selector.items(), labels.items(), name)
        service = self.by_kind["Service"]["badge-control"]
        control_labels = self.by_kind["Deployment"]["badge-control"]["spec"]["template"]["metadata"]["labels"]
        self.assertLessEqual(service["spec"]["selector"].items(), control_labels.items())
        self.assertEqual(service["spec"]["ports"][0]["port"], 8090)

    def test_pods_are_locked_down_and_fetch_their_code(self):
        for name, deployment in self.by_kind["Deployment"].items():
            pod = deployment["spec"]["template"]["spec"]
            self.assertFalse(pod["automountServiceAccountToken"], name)
            self.assertTrue(pod["securityContext"]["runAsNonRoot"], name)
            (init,) = pod["initContainers"]
            (container,) = pod["containers"]
            for c in (init, container):
                self.assertTrue(c["securityContext"]["readOnlyRootFilesystem"], name)
                self.assertRegex(c["image"], r":\d+\.\d+", f"{name} image must be pinned")
            self.assertEqual(init["command"], ["python", "/opt/fetch/fetch.py"])
            init_mounts = {m["name"]: m["mountPath"] for m in init["volumeMounts"]}
            mounts = {m["name"]: m for m in container["volumeMounts"]}
            self.assertEqual(init_mounts["code"], "/opt/badge/src")
            self.assertEqual(mounts["code"]["mountPath"], "/opt/badge/src")
            self.assertTrue(mounts["code"]["readOnly"], name)
            volumes = {v["name"]: v for v in pod["volumes"]}
            self.assertEqual(volumes["fetch"]["configMap"]["name"], "badge-fetch-code")
            self.assertIn("emptyDir", volumes["code"])
            env = {e["name"]: e["value"] for e in container.get("env", [])}
            if env["BADGE_ROLE"] == "station":
                self.assertEqual(f"badge-{env['BADGE_STATION_ID']}", name)
            else:
                self.assertEqual(env["BADGE_ROLE"], "control")
            refs = {list(r.values())[0]["name"] for r in container["envFrom"]}
            self.assertEqual(refs, {"badge-config", "badge-secrets"})

    def test_config_points_at_the_fetched_code(self):
        data = self.by_kind["ConfigMap"]["badge-config"]["data"]
        self.assertEqual(data["PYTHONPATH"], "/opt/badge/src")
        self.assertEqual(data["BADGE_CONTROL_URL"], "http://badge-control:8090")
        self.assertEqual(data["KUBE_NAMESPACE"], "team-backstage")
        self.assertEqual(data["INCIDENT_API_BASE_URL"], "http://incident-api:8000/api/v1")
        for key in data:
            self.assertNotRegex(key, "TOKEN|KEY|SECRET", f"{key} belongs in badge-secrets")

    def test_code_is_pinned_to_a_full_commit(self):
        sha = fetch_config()["CODE_SHA"]
        self.assertRegex(sha, r"^[0-9a-f]{40}$")
        if shutil.which("git"):
            result = subprocess.run(["git", "cat-file", "-e", f"{sha}:services/badge-simulator/badge_sim/server.py"],
                                    cwd=ROOT, capture_output=True)
            self.assertEqual(result.returncode, 0, f"CODE_SHA {sha} does not contain the badge simulator")

    def test_platform_overlay(self):
        overlay = yaml.safe_load((PLATFORM / "kustomization.yaml").read_text(encoding="utf-8"))
        self.assertEqual(overlay["namespace"], "team-backstage")
        self.assertIn("../badge", overlay["resources"])
        self.assertIn("../incident", overlay["resources"])
        for resource in overlay["resources"]:
            self.assertTrue((PLATFORM / resource / "kustomization.yaml").is_file(), resource)

    def test_job_scripts_parse(self):
        for name in ("drill-job.yaml", "incident-rehearsal-job.yaml"):
            with self.subTest(job=name):
                (job,) = [d for d in yaml.safe_load_all((BADGE / name).read_text(encoding="utf-8")) if d]
                self.assertEqual(job["kind"], "Job")
                spec = job["spec"]["template"]["spec"]
                self.assertFalse(spec["automountServiceAccountToken"])
                script = spec["containers"][0]["command"][-1]
                compile(script, name, "exec")
                self.assertNotRegex(script, r"print\([^)]*(TOKEN|tok\b|ORG\b)", "jobs must never print tokens")


@unittest.skipIf(yaml is None, "PyYAML not installed")
class FetchCodeTests(unittest.TestCase):
    """Runs the exact fetch.py from the ConfigMap against a local tarball, then the pods' command."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="badge-fetch-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        config = fetch_config()
        self.script = Path(self.tmp) / "fetch.py"
        self.script.write_text(config["fetch.py"], encoding="utf-8")
        self.code = Path(self.tmp) / "src"
        evil = [
            ("Backstage-abc123/services/badge-simulator/badge_sim/../../evil.py", b"raise SystemExit('pwned')"),
            ("Backstage-abc123/services/other/badge_sim/x.py", b""),
        ]
        self.server = serve_bytes(source_tarball(evil))
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.env = {
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "CODE_REPO": config["CODE_REPO"],
            "CODE_SHA": config["CODE_SHA"],
            "CODE_URL": f"http://127.0.0.1:{self.server.server_port}/archive.tar.gz",
            "CODE_DIR": str(self.code),
        }

    def fetch(self):
        return subprocess.run([sys.executable, str(self.script)], env=self.env, capture_output=True, text=True,
                              cwd=self.tmp, timeout=60)

    def test_extracts_only_runtime_packages(self):
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"fetched \d+ files")
        files = {p.relative_to(self.code).as_posix() for p in self.code.rglob("*.py")}
        self.assertIn("badge_sim/server.py", files)
        self.assertIn("radar/adapter.py", files)
        self.assertFalse(any(f.startswith("tests/") for f in files), files)
        self.assertFalse((Path(self.tmp) / "evil.py").exists())
        self.assertFalse(any("evil" in f or f.startswith("x") for f in files), files)

    def test_fetched_code_runs_control_and_station_like_the_pods(self):
        self.assertEqual(self.fetch().returncode, 0)
        port = free_port()
        base_env = {
            "PATH": self.env["PATH"],
            "SYSTEMROOT": self.env["SYSTEMROOT"],
            "PYTHONPATH": str(self.code),
            "PYTHONDONTWRITEBYTECODE": "1",
            "BADGE_INTERNAL_TOKEN": "fetch-test",
            "BADGE_PORT": str(port),
            "BADGE_HEARTBEAT_SECONDS": "0.2",
        }
        control = subprocess.Popen(
            [sys.executable, "-m", "badge_sim", "serve"], cwd=self.tmp,
            env={**base_env, "BADGE_ROLE": "control", "BADGE_ARTIFACT_DIR": str(Path(self.tmp) / "art")},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        station = subprocess.Popen(
            [sys.executable, "-m", "badge_sim", "serve"], cwd=self.tmp,
            env={**base_env, "BADGE_ROLE": "station", "BADGE_STATION_ID": "station-b",
                 "BADGE_PORT": str(free_port()), "BADGE_CONTROL_URL": f"http://127.0.0.1:{port}"},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            view = None
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    request = Request(f"http://127.0.0.1:{port}/internal/stations/station-b",
                                      headers={"Authorization": "Bearer fetch-test"})
                    with urlopen(request, timeout=2) as response:
                        view = json.load(response)
                    if view["heartbeat_age_s"] is not None:
                        break
                except OSError:
                    pass
                time.sleep(0.2)
            self.assertIsNotNone(view, "badge-control never answered")
            self.assertIsNotNone(view["heartbeat_age_s"], "station-b never heartbeated to badge-control")
        finally:
            for process in (station, control):
                process.terminate()
                process.wait(timeout=10)


class ReadmeTests(unittest.TestCase):
    def test_readme_has_no_stale_bundle_instructions(self):
        text = (BADGE / "README.md").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"render_code_configmap|badge-sim\.zip", text))


if __name__ == "__main__":
    unittest.main()
