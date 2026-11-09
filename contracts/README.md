# Shared v1 contracts

- [OpenAPI 3.1](openapi.yaml) describes the incident API on port 8000 and internal badge-control endpoints on port 8090.
- [Signal schema](signal.v1.schema.json) covers count, stage, badge, and human report ingress.
- [Protocol schema](protocol.v1.schema.json) covers audit events and transition references.
- [Badge schema](badge.v1.schema.json) defines the internal diagnosis, reroute, and job status payloads.

The contracts use JSON Schema 2020-12. Timestamps are RFC 3339 in UTC, IDs are opaque, and fields use snake_case. Start with the [shared fixtures](../fixtures/shared/README.md). Submit schema changes with compatibility and affected consumer notes.
