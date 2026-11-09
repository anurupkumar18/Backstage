import json
from pathlib import Path
from unittest import TestCase
from urllib.parse import urljoin

import yaml
from jsonschema import Draft202012Validator
from openapi_spec_validator import validate
from referencing import Registry
from referencing.jsonschema import DRAFT202012

from scripts.fixture_server import FIXTURES, read_examples

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
API_URI = (CONTRACTS / "openapi.yaml").as_uri()
API = yaml.safe_load((CONTRACTS / "openapi.yaml").read_text())
SCHEMAS = {path.name: json.loads(path.read_text()) for path in CONTRACTS.glob("*.schema.json")}
REGISTRY = Registry().with_resources(
    [(API_URI, DRAFT202012.create_resource(API))]
    + [((CONTRACTS / name).as_uri(), DRAFT202012.create_resource(schema)) for name, schema in SCHEMAS.items()]
)


def validator(target):
    return Draft202012Validator(
        {"$ref": urljoin(API_URI, target["$ref"])},
        registry=REGISTRY,
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )


class ContractTests(TestCase):
    def test_contract_definitions(self):
        validate(API, base_uri=API_URI)
        for schema in SCHEMAS.values():
            Draft202012Validator.check_schema(schema)

    def test_replays(self):
        validate_signal = validator({"$ref": "./signal.v1.schema.json"})
        for path in sorted(FIXTURES.glob("*.signals.jsonl")):
            with self.subTest(replay=path.name):
                signals = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertTrue(signals)
                self.assertEqual(len(signals), len({signal["signal_id"] for signal in signals}))
                for signal in signals:
                    validate_signal.validate(signal)

    def test_http_examples(self):
        covered = set()
        for example in read_examples():
            route = example["route"]
            method = example["method"].lower()
            with self.subTest(scenario=example["scenario"], route=route, status=example["status"]):
                operation = API["paths"][route][method]
                if "request" in example:
                    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
                    validator(request_schema).validate(example["request"])
                response_schema = operation["responses"][str(example["status"])]["content"]["application/json"]["schema"]
                validator(response_schema).validate(example["response"])
                if example["status"] < 300:
                    covered.add((route, method))
        self.assertEqual(covered, {(route, method) for route, methods in API["paths"].items() for method in methods})
