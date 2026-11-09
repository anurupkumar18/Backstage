"""Validate the shared v1 signal and browser action shapes."""

import json
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

from .engine import ApiError

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
SIGNAL = Draft202012Validator(
    json.loads((CONTRACTS / "signal.v1.schema.json").read_text(encoding="utf-8")),
    format_checker=Draft202012Validator.FORMAT_CHECKER,
)
OPENAPI = yaml.safe_load((CONTRACTS / "openapi.yaml").read_text(encoding="utf-8"))
ACTION = Draft202012Validator(OPENAPI["components"]["schemas"]["Action"])


def validate_signal(body):
    if not SIGNAL.is_valid(body):
        raise ApiError(422, "invalid_payload", "The body does not match the v1 signal schema.")


def validate_action(body, key):
    if not key or len(key) > 128:
        raise ApiError(422, "invalid_payload", "Supply an Idempotency-Key of 1 to 128 characters.")
    if not ACTION.is_valid(body):
        raise ApiError(422, "invalid_payload", "The body does not match a v1 incident action.")
