# Backstage

Backstage coordinates incident response on a conference floor. Its first target is a Room B overflow replay that moves through approval, staff acceptance, and evidence-based recovery.

This bootstrap publishes the v1 API contract, shared fixtures, and directories for each contributor. The fixture server lets consumers try the HTTP examples while the production services are under development.

## Local setup

Use Python 3.12 or 3.13 and Make.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-check.txt
make check
make smoke SCENARIO=overflow
make dev SCENARIO=overflow
```

The fixture server listens on `127.0.0.1:8000`. Try `curl http://127.0.0.1:8000/api/v1/incidents` or `curl http://127.0.0.1:8000/api/v1/incidents/inc-overflow-room-b/events`. The `stage_av` and `badge_stall` scenarios are also available. The fixture server serves static responses for GET routes. Use the request and error examples to build stateful mocks and service implementations.

## Team

- [Latest team updates and how to hand off each push](docs/handoffs/README.md)
- [Full team handoff](BACKSTAGE-team-agent-handoff.md)
- [Kunj · React, accessibility, and Dash0](docs/handoffs/kunj.md)
- [Ali · Badge simulator, Radar, and Kubernetes](docs/handoffs/ali.md)
- [Ownership and contribution workflow](CONTRIBUTING.md)
- [OpenAPI contract and schemas](contracts/README.md)
- [Fixture index](fixtures/shared/README.md)
