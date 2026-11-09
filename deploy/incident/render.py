"""Render standalone YAML for Radar apply_resource without kubectl."""
from pathlib import Path
import yaml

root = Path(__file__).resolve().parent
resources = [{
    "apiVersion": "v1", "kind": "ConfigMap",
    "metadata": {"name": "incident-bootstrap", "namespace": "team-backstage"},
    "data": {"bootstrap.py": (root / "bootstrap.py").read_text()},
}]
for resource in yaml.safe_load_all((root / "incident-api.yaml").read_text()):
    resource["metadata"]["namespace"] = "team-backstage"
    resources.append(resource)
print(yaml.safe_dump_all(resources, sort_keys=False), end="")
