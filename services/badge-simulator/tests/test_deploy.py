"""Checks for deploy/badge and deploy/platform. kubectl is not required."""

import base64
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
BADGE = ROOT / "deploy" / "badge"
PLATFORM = ROOT / "deploy" / "platform"

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


def load_renderer():
    spec = importlib.util.spec_from_file_location("render_code_configmap", BADGE / "render_code_configmap.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


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
        self.assertEqual(set(self.by_kind["ConfigMap"]), {"badge-config", "badge-code"})
        self.assertNotIn("Secret", self.by_kind, "secrets must never be committed")
        self.assertNotIn("Namespace", self.by_kind, "team-backstage is provisioned by the event")

    def test_selectors_and_service(self):
        for name, deployment in self.by_kind["Deployment"].items():
            selector = deployment["spec"]["selector"]["matchLabels"]
            labels = deployment["spec"]["template"]["metadata"]["labels"]
            self.assertLessEqual(selector.items(), labels.items(), name)
        service = self.by_kind["Service"]["badge-control"]
        control_labels = self.by_kind["Deployment"]["badge-control"]["spec"]["template"]["metadata"]["labels"]
        self.assertLessEqual(service["spec"]["selector"].items(), control_labels.items())
        self.assertEqual(service["spec"]["ports"][0]["port"], 8090)

    def test_pods_are_locked_down_and_wired(self):
        for name, deployment in self.by_kind["Deployment"].items():
            pod = deployment["spec"]["template"]["spec"]
            self.assertFalse(pod["automountServiceAccountToken"], name)
            self.assertTrue(pod["securityContext"]["runAsNonRoot"], name)
            (container,) = pod["containers"]
            self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"], name)
            self.assertRegex(container["image"], r":\d+\.\d+", f"{name} image must be pinned")
            env = {e["name"]: e["value"] for e in container.get("env", [])}
            role = env["BADGE_ROLE"]
            self.assertIn(role, ("control", "station"))
            if role == "station":
                self.assertEqual(f"badge-{env['BADGE_STATION_ID']}", name)
            refs = {list(r.values())[0]["name"] for r in container["envFrom"]}
            self.assertEqual(refs, {"badge-config", "badge-secrets"})
            mounts = {m["name"]: m["mountPath"] for m in container["volumeMounts"]}
            self.assertEqual(mounts["code"], "/opt/badge")

    def test_config_points_at_the_bundle_and_service(self):
        data = self.by_kind["ConfigMap"]["badge-config"]["data"]
        self.assertEqual(data["PYTHONPATH"], "/opt/badge/badge-sim.zip")
        self.assertEqual(data["BADGE_CONTROL_URL"], "http://badge-control:8090")
        self.assertEqual(data["KUBE_NAMESPACE"], "team-backstage")
        for key in data:
            self.assertNotRegex(key, "TOKEN|KEY|SECRET", f"{key} belongs in badge-secrets")

    def test_platform_overlay(self):
        overlay = yaml.safe_load((PLATFORM / "kustomization.yaml").read_text(encoding="utf-8"))
        self.assertEqual(overlay["namespace"], "team-backstage")
        self.assertIn("../badge", overlay["resources"])


class CodeBundleTests(unittest.TestCase):
    def test_configmap_matches_the_source(self):
        renderer = load_renderer()
        current = (BADGE / "badge-code.configmap.yaml").read_text(encoding="utf-8").replace("\r\n", "\n")
        self.assertEqual(current, renderer.render(), "run python deploy/badge/render_code_configmap.py")

    def test_bundle_runs_control_and_station_like_the_pods(self):
        """Run badge-control and one station from the zip alone, in separate processes."""
        data = load_renderer().bundle()
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp) / "badge-sim.zip"
            bundle.write_bytes(data)
            port = free_port()
            base_env = {
                "PATH": os.environ.get("PATH", ""),
                "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
                "PYTHONPATH": str(bundle),
                "PYTHONDONTWRITEBYTECODE": "1",
                "BADGE_INTERNAL_TOKEN": "bundle-test",
                "BADGE_PORT": str(port),
                "BADGE_HEARTBEAT_SECONDS": "0.2",
            }
            control = subprocess.Popen(
                [sys.executable, "-m", "badge_sim", "serve"],
                cwd=tmp, env={**base_env, "BADGE_ROLE": "control", "BADGE_ARTIFACT_DIR": str(Path(tmp) / "art")},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            station = subprocess.Popen(
                [sys.executable, "-m", "badge_sim", "serve"],
                cwd=tmp,
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
                                          headers={"Authorization": "Bearer bundle-test"})
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

    def test_bundle_contains_only_runtime_packages(self):
        import io
        import zipfile

        names = zipfile.ZipFile(io.BytesIO(load_renderer().bundle())).namelist()
        self.assertTrue(all(n.split("/")[0] in ("badge_sim", "radar") for n in names))
        self.assertIn("badge_sim/__main__.py", names)
        self.assertIn("radar/adapter.py", names)
        self.assertLess(len(base64.b64encode(io.BytesIO(load_renderer().bundle()).getvalue())), 900_000)


if __name__ == "__main__":
    unittest.main()
