# Backstage review guidance

- Flag agent or worker tool calls that lack a server-side tier and scope allowlist check before execution. External side effects also require the plan and human acceptance gates described in the team handoff.
- Flag incident transitions that bypass the validated state machine, or committed transitions without a correlated OpenTelemetry span and protocol event.
- Flag reservation writes that lack a deterministic equipment-and-UTC-slot document ID and create-only semantics. Retries may resume a reservation only for the same incident and dispatch intent.
