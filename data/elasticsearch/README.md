# Elasticsearch

## Overflow demo storage

Create a standard index named backstage-overflow-state-v1 with the [index definition](overflow-state-v1.json). It includes the backstage-overflow-state write alias. Use the alias for application access. For an isolated rehearsal, use backstage-smoke-overflow-state-v1 and change the alias key to backstage-smoke-overflow-state before creating the index.

The index stores a versioned checkpoint at document ID overflow-demo. It contains the Room B lifecycle and timeline, evidence windows, assignments, and retry receipts. Elasticsearch stores the checkpoint as JSON and only maps its schema version. Keep one API writer per alias. Conditional writes use Elasticsearch sequence numbers and primary terms to protect the last committed state.

An administrator provisions the index and alias. The runtime API key needs read and index privileges for the configured alias. A separate index per environment keeps smoke replays out of the shared demo. Only submit synthetic count fixtures to a smoke index.

See the [incident API instructions](../../services/incident-api/README.md) for live mode and the restart test.
