"""Validate payloads against the shared, read-only contracts in /contracts.

Needs `jsonschema` (installed by the repo's requirements-check.txt). Returns
None from `validators()` when it is unavailable so callers can skip.
"""

import json
from pathlib import Path

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"


def validators():
    try:
        from jsonschema import Draft202012Validator
        from referencing import Registry
        from referencing.jsonschema import DRAFT202012
    except ImportError:
        return None
    schemas = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in CONTRACTS.glob("*.schema.json")}
    registry = Registry().with_resources(
        [((CONTRACTS / name).as_uri(), DRAFT202012.create_resource(schema)) for name, schema in schemas.items()]
    )

    def make(ref):
        name, _, pointer = ref.partition("#")
        return Draft202012Validator(
            {"$ref": (CONTRACTS / name).as_uri() + (f"#{pointer}" if pointer else "")},
            registry=registry,
            format_checker=Draft202012Validator.FORMAT_CHECKER,
        )

    return {
        "signal": make("signal.v1.schema.json"),
        "diagnose_response": make("badge.v1.schema.json#/$defs/diagnose_response"),
        "reroute_request": make("badge.v1.schema.json#/$defs/reroute_request"),
        "reroute_response": make("badge.v1.schema.json#/$defs/reroute_response"),
        "job_status": make("badge.v1.schema.json#/$defs/job_status"),
    }
