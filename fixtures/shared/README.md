# Shared fixtures

- `overflow.signals.jsonl` replays Room B seating capacity, 30 seconds of door counts over threshold, and 60 seconds of clearing samples.
- `stage_av.signals.jsonl` covers mic loss, stale caption metadata, mic restoration, and a new caption line.
- `badge_stall.signals.jsonl` covers Station A going offline and Station B completing the same three logical jobs.
- `http.examples.json` contains request and response examples for the public API and internal badge-control boundary. Scenario, method, path, and status identify the cases. Use `make dev SCENARIO=overflow` to serve a scenario's GET examples.

All data is synthetic. Treat signal timestamps as replay evidence times.
