# Elasticsearch

## Overflow demo storage

Create a standard index named backstage-overflow-state-v1 with the [index definition](overflow-state-v1.json). It includes the backstage-overflow-state write alias. Use the alias for application access. For an isolated rehearsal, use backstage-smoke-overflow-state-v1 and change the alias key to backstage-smoke-overflow-state before creating the index.

The index stores a versioned checkpoint at document ID overflow-demo. It contains the Room B lifecycle and timeline, evidence windows, assignments, and retry receipts. Elasticsearch stores the checkpoint as JSON and only maps its schema version. Keep one API writer per alias. Conditional writes use Elasticsearch sequence numbers and primary terms to protect the last committed state.

An administrator provisions the index and alias. The runtime API key needs read and index privileges for the configured alias. A separate index per environment keeps smoke replays out of the shared demo. Only submit synthetic count fixtures to a smoke index.

See the [incident API instructions](../../services/incident-api/README.md) for live mode and the restart test.

## Committed incident evidence

The optional evidence index is separate from the authoritative checkpoint. Provision it with the strict [event mapping](incident-evidence-v1.json), using an isolated prefix for QA. The projection contains immutable committed protocol event facts, source-grounded text summaries, and only each event's explicitly referenced signals enriched with stored observation/receipt times and allowlisted count facts. It does not infer a pre-trigger signal association, migrate checkpoint provenance, or index camera images, caption text or arbitrary request bodies.

With `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` already present in the environment:

```sh
python3 data/elasticsearch/bootstrap-evidence.py --prefix backstage-qa-example
```

The command creates `backstage-qa-example-incident-evidence-v1` and write alias `backstage-qa-example-incident-evidence`. It refuses an existing alias and never reads a credential file or prints credential values. Provision the corresponding isolated checkpoint separately; then set `ELASTICSEARCH_INDEX_PREFIX=backstage-qa-example` and `EVIDENCE_PROJECTION_ENABLED=true` on the API. Keep one writer per checkpoint alias.

The provisioning principal needs index/alias creation rights. Runtime access needs checkpoint read/index privileges as before, plus evidence read, create-only writes and refresh rights (`read`, `create_doc`, `maintenance` and alias visibility as required by your Elasticsearch deployment). Runtime writes require the evidence alias and never auto-create a missing index. Search or projection failure does not roll back an acknowledged incident transition. The checkpoint timeline stays readable while evidence is pending or degraded.

Every projection chunk checks individual bulk item results. A 409 succeeds only if the existing stored hash and a recomputed hash of its content match the immutable expected document. The watermark advances only after all documents pass and Elasticsearch refresh acknowledges zero failed shards. Repeated projection/restart uses deterministic event IDs. Text search is lexical, scoped and bounded; semantic search is outside this slice.
