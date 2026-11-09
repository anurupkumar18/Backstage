"""Connect existing badge workloads after the incident API becomes ready."""
import argparse
import base64
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, help="Explicit kubectl context to deploy to")
    parser.add_argument("--apply", action="store_true", help="Deploy and connect; otherwise check prerequisites only")
    args = parser.parse_args()
    base = ["kubectl", "--context", args.context, "-n", "team-backstage"]

    def kube(*command, body=None):
        result = subprocess.run(base + list(command), input=body, text=True, capture_output=True)
        if result.returncode:
            # Secret API errors can echo request bodies. Never print captured output here.
            raise SystemExit(f"Kubernetes operation failed ({command[0]} {command[1]}). Check context, permissions and workload health.")
        return result.stdout

    def secret(name):
        return {key: base64.b64decode(value).decode() for key, value in
                json.loads(kube("get", "secret", name, "-o", "json"))["data"].items()}

    incident = secret("incident-secrets")
    badge = secret("badge-secrets")
    for key in ("ELASTICSEARCH_URL", "ELASTICSEARCH_API_KEY", "ELASTICSEARCH_INDEX_PREFIX", "AUTH_TOKENS_JSON"):
        if not incident.get(key):
            raise SystemExit(f"incident-secrets is missing {key}")
    if not badge.get("BADGE_INTERNAL_TOKEN"):
        raise SystemExit("badge-secrets is missing BADGE_INTERNAL_TOKEN")
    identities = json.loads(incident["AUTH_TOKENS_JSON"])
    tokens = [token for token, actor in identities.items()
              if actor.get("tier") is None
              and set(actor.get("source_ids", [])) == {"station-a", "station-b"}
              and set(actor.get("room_ids", [])) == {"room-c"}
              and set(actor.get("signal_kinds", [])) == {"badge_health", "badge_job_complete"}]
    if len(tokens) != 1 or not tokens[0]:
        raise SystemExit("Configure exactly one scoped badge producer identity in AUTH_TOKENS_JSON")
    print("Secret prerequisites checked. No credential values printed.")
    if not args.apply:
        return
    kube("apply", "-k", str(Path(__file__).resolve().parent))
    kube("rollout", "status", "deployment/incident-api", "--timeout=300s")
    # Merge only the signal token, preserving Ali's internal and Radar credentials.
    kube("patch", "secret", "badge-secrets", "--type=merge", "--patch-file=/dev/stdin",
         body=json.dumps({"data": {"BADGE_SIGNAL_TOKEN": base64.b64encode(tokens[0].encode()).decode()}}))
    kube("patch", "configmap", "badge-config", "--type=merge", "--patch-file=/dev/stdin",
         body=json.dumps({"data": {"INCIDENT_API_BASE_URL": "http://incident-api:8000/api/v1"}}))
    for name in ("badge-control", "badge-station-a", "badge-station-b"):
        kube("rollout", "restart", f"deployment/{name}")
        kube("rollout", "status", f"deployment/{name}", "--timeout=180s")
    print("API ready and badge workloads restarted with the connection. Run the combined rehearsal next.")


if __name__ == "__main__":
    main()
