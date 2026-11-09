"""Committed evidence projection and incident-scoped diagnostics/search regressions."""
import json
from copy import deepcopy
from datetime import datetime
from threading import Event, Thread
from unittest import TestCase

from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from backstage_api.main import create_app
from test_overflow import API, FIXTURE, IDENTITIES
from test_persistence import CheckpointTransport


class EvidenceClient:
    """Small Elasticsearch projection/search boundary; checkpoint uses the real SDK separately."""
    def __init__(self):
        self.documents = {}
        self.fail_ids = set()
        self.search_error = False
        self.queries = []
        self.refreshes = 0
        self.indices = self
        self.block = None

    def bulk(self, *, operations, **kwargs):
        if self.block:
            entered, release = self.block
            entered.set()
            release.wait(3)
        items = []
        for action, document in zip(operations[::2], operations[1::2]):
            event_id = action['create']['_id']
            status = 503 if event_id in self.fail_ids else 409 if event_id in self.documents else 201
            if status == 201:
                self.documents[event_id] = deepcopy(document)
            items.append({'create': {'_id': event_id, 'status': status}})
        return {'items': items}

    def get(self, *, id, **kwargs):
        return {'_source': deepcopy(self.documents[id])}

    def refresh(self, **kwargs):
        self.refreshes += 1
        return {'_shards': {'failed': 0}}

    def search(self, **kwargs):
        self.queries.append(kwargs)
        if self.search_error:
            raise OSError('do not expose provider secrets')
        # Deliberately return an untrusted unauthorized hit: app must recheck it.
        hits = [{'_id': key, '_source': deepcopy(doc)} for key, doc in self.documents.items()]
        hits.append({'_id': 'forged', '_source': {'incident_id': 'not-authorized'}})
        return {'hits': {'total': {'value': len(hits), 'relation': 'eq'}, 'hits': hits}}


class EvidenceTests(TestCase):
    def setUp(self):
        self.backend = CheckpointTransport()
        self.es = EvidenceClient()
        self.now = datetime.fromisoformat('2026-11-09T19:00:00Z')
        self.signals = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
        self.exporter = InMemorySpanExporter()
        self.provider = TracerProvider(shutdown_on_exit=False)
        self.provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.addCleanup(self.provider.shutdown)

    def app(self, checkpoint=True):
        from backstage_api.evidence import EvidenceProjection
        self.projection = EvidenceProjection(self.es, 'test-evidence', self.provider.get_tracer('test'))
        self.application = create_app(clock=lambda: self.now, identities=IDENTITIES,
                                      tracer_provider=self.provider,
                                      checkpoint=self.backend.checkpoint() if checkpoint else None,
                                      evidence_projection=self.projection)
        return self.enterContext(TestClient(self.application))

    def request(self, client, method, path, *, token='organizer', body=None, key=None, status=200):
        headers = {'Authorization': f'Bearer {token}'}
        if key:
            headers['Idempotency-Key'] = key
        response = client.request(method, API + path, json=body, headers=headers)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def trigger(self, client):
        for sample in self.signals[:4]:
            self.now = datetime.fromisoformat(sample['occurred_at'])
            receipt = self.request(client, 'POST', '/signals', token='camera', body=sample, status=202)
        self.path = '/incidents/' + receipt['incident_id']
        return self.request(client, 'GET', self.path)

    def approve(self, client, incident, status=200):
        return self.request(client, 'POST', self.path + '/actions', key='approve', status=status,
                            body={'action': 'approve', 'expected_version': incident['version'],
                                  'payload': {'plan_id': incident['plan']['id']}})

    def test_failed_save_has_attempt_but_no_committed_event_or_projection(self):
        client = self.app()
        incident = self.trigger(client)
        self.application.state.project_evidence()
        committed_before = [s for s in self.exporter.get_finished_spans() if s.name == 'incident.transition']
        self.backend.fail_before_save = True
        self.approve(client, incident, status=503)
        self.application.state.project_evidence()
        self.assertEqual(len(self.es.documents), 3)
        committed_after = [s for s in self.exporter.get_finished_spans() if s.name == 'incident.transition']
        self.assertEqual(committed_after, committed_before)
        self.assertTrue(any(s.name == 'incident.transition.attempt' for s in self.exporter.get_finished_spans()))

    def test_partial_failure_never_advances_watermark_and_retries_create_only(self):
        client = self.app()
        incident = self.trigger(client)
        bad = incident['id'] + '-2'
        self.es.fail_ids.add(bad)
        self.application.state.project_evidence()
        diagnostics = self.request(client, 'GET', self.path + '/diagnostics')
        self.assertEqual(diagnostics['projection']['status'], 'degraded')
        self.assertIsNone(diagnostics['projection']['indexed_revision'])
        self.assertEqual(self.projection.failures, [{'event_id': bad, 'status': 503, 'code': 'item_failed'}])
        self.es.fail_ids.clear()
        self.application.state.project_evidence()
        diagnostics = self.request(client, 'GET', self.path + '/diagnostics')
        self.assertEqual(diagnostics['projection']['status'], 'current')
        self.assertEqual(diagnostics['projection']['checkpoint_revision'], diagnostics['projection']['indexed_revision'])
        self.assertEqual(self.es.refreshes, 1)
        self.assertEqual(len(self.es.documents), 3)
        self.es.documents[bad]['content_hash'] = 'different'
        self.projection.indexed_revision = None
        self.application.state.project_evidence()
        self.assertEqual(self.projection.failures, [{'event_id': bad, 'status': 409, 'code': 'content_conflict'}])

    def test_projection_copies_committed_state_and_never_holds_runtime_lock_during_io(self):
        client = self.app()
        incident = self.trigger(client)
        entered, release = Event(), Event()
        self.es.block = (entered, release)
        worker = Thread(target=self.application.state.project_evidence)
        worker.start()
        self.assertTrue(entered.wait(2))
        try:
            self.approve(client, incident)
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(self.es.documents), 3)
        self.assertEqual(self.request(client, 'GET', self.path + '/diagnostics')['projection']['status'], 'pending')
        self.es.block = None
        self.application.state.project_evidence()
        self.assertEqual(len(self.es.documents), 5)

    def test_diagnostics_use_actual_receipt_times_scope_and_unknown_provenance(self):
        client = self.app()
        incident = self.trigger(client)
        data = self.request(client, 'GET', self.path + '/diagnostics')
        self.assertEqual(data['storage'], {'mode': 'elasticsearch', 'durable': True})
        self.assertEqual(data['provenance'], {'origin': 'unknown'})
        self.assertEqual(data['version'], incident['version'])
        sample = data['signals'][0]
        self.assertEqual(sample['signal_id'], self.signals[3]['signal_id'])
        self.assertEqual(sample['facts'], self.signals[3]['data'])
        self.assertEqual(sample['observed_at'], self.signals[3]['occurred_at'])
        self.assertEqual(sample['received_at'], self.signals[3]['occurred_at'])
        self.assertEqual(data['events'][0]['signal_ids'], [sample['signal_id']])
        self.request(client, 'GET', self.path + '/diagnostics', token='attendee', status=403)
        self.request(client, 'GET', self.path + '/diagnostics', token='other-speaker', status=404)
        self.assertIsNone(data['trace']['url'])

    def test_search_filters_authorized_ids_before_query_and_rechecks_hits(self):
        client = self.app()
        incident = self.trigger(client)
        self.application.state.project_evidence()
        result = self.request(client, 'GET', '/evidence/search?q=raise&limit=20')
        self.assertEqual(result['total'], 3)
        self.assertEqual(len(result['items']), 3)
        filters = self.es.queries[-1]['query']['bool']['filter']
        self.assertIn({'terms': {'incident_id': [incident['id']]}}, filters)
        self.assertNotIn('query_string', str(self.es.queries[-1]))
        other = self.request(client, 'GET', '/evidence/search', token='other-speaker')
        self.assertEqual(other['items'], [])
        self.assertEqual(other['total'], 0)
        self.request(client, 'GET', '/evidence/search', token='attendee', status=403)
        self.request(client, 'GET', '/evidence/search?limit=51', status=422)
        self.request(client, 'GET', '/evidence/search?from=invalid', status=422)
        self.es.search_error = True
        error = self.request(client, 'GET', '/evidence/search', status=503)
        self.assertEqual(error['error']['code'], 'evidence_unavailable')
        self.assertNotIn('secrets', str(error))

    def test_http_extracts_w3c_and_committed_spans_link_later_request(self):
        client = self.app()
        parent_trace = '1234567890abcdef1234567890abcdef'
        sample = self.signals[0]
        self.now = datetime.fromisoformat(sample['occurred_at'])
        response = client.post(API + '/signals', json=sample, headers={
            'Authorization': 'Bearer camera',
            'traceparent': '00-' + parent_trace + '-1234567890abcdef-01',
        })
        self.assertEqual(response.status_code, 202)
        spans = self.exporter.get_finished_spans()
        request = [span for span in spans if span.name == 'http.request'][-1]
        self.assertEqual(f'{request.context.trace_id:032x}', parent_trace)
        self.assertEqual(request.parent.span_id, int('1234567890abcdef', 16))
        self.assertNotIn('url.full', request.attributes)
        incident = self.trigger(client)
        self.approve(client, incident)
        committed = [span for span in self.exporter.get_finished_spans()
                     if span.name == 'incident.transition' and span.attributes['incident.event.type'] == 'approve']
        self.assertEqual(len(committed), 1)
        self.assertTrue(committed[0].links)

    def test_memory_storage_and_disabled_search_are_explicit(self):
        app = create_app(clock=lambda: self.now, identities=IDENTITIES, tracer_provider=self.provider)
        client = self.enterContext(TestClient(app))
        self.trigger(client)
        diagnostics = self.request(client, 'GET', self.path + '/diagnostics')
        self.assertEqual(diagnostics['storage'], {'mode': 'memory', 'durable': False})
        self.assertEqual(diagnostics['projection']['status'], 'disabled')
        self.request(client, 'GET', '/evidence/search', status=503)

    def test_ambiguous_commit_is_projected_only_after_durable_reload_and_restart_is_idempotent(self):
        client = self.app()
        incident = self.trigger(client)
        self.application.state.project_evidence()
        self.backend.lose_ack = True
        self.approve(client, incident, status=503)
        self.assertEqual(len(self.es.documents), 3)
        self.application.state.project_evidence()
        self.assertEqual(len(self.es.documents), 5)
        snapshot = self.application.state.runtime.snapshot()
        from backstage_api.evidence import EvidenceProjection
        restarted = EvidenceProjection(self.es, 'test-evidence', self.provider.get_tracer('test'))
        restarted.project(snapshot)
        self.assertEqual(restarted.freshness(snapshot)['status'], 'current')
        self.assertEqual(len(self.es.documents), 5)

    def test_resolved_diagnostics_preserve_full_verified_duration_after_samples_age(self):
        from datetime import timedelta
        client = self.app()
        incident = self.trigger(client)
        self.approve(client, incident)
        dispatched = self.request(client, 'GET', self.path)
        self.request(client, 'POST', self.path + '/actions', token='staff', key='accept',
                     body={'action': 'ack', 'expected_version': dispatched['version'],
                           'payload': {'assignment_id': dispatched['assignment']['id'], 'decision': 'accepted'}})
        for sample in self.signals[4:]:
            self.now = datetime.fromisoformat(sample['occurred_at'])
            self.request(client, 'POST', '/signals', token='camera', body=sample, status=202)
        self.now += timedelta(days=1)
        data = self.request(client, 'GET', self.path + '/diagnostics')
        self.assertEqual(data['verification']['status'], 'passed')
        self.assertEqual(data['verification']['observed_duration_s'], 60)
        self.assertEqual(data['verification']['evidence_signal_ids'], data['events'][-1]['signal_ids'])

    def test_trace_template_rejects_credentials_fragment_external_host_and_query(self):
        from backstage_api.evidence import trace_url
        tid = '1234567890abcdef1234567890abcdef'
        self.assertEqual(trace_url('https://app.dash0.com/traces/{trace_id}', tid),
                         'https://app.dash0.com/traces/' + tid)
        for template in ('https://evil.example/{trace_id}', 'https://secret@app.dash0.com/{trace_id}',
                         'https://app.dash0.com/{trace_id}#secret',
                         'https://app.dash0.com/{trace_id}?token=secret',
                         'http://app.dash0.com/{trace_id}', 'https://app.dash0.com/{trace_id}/{other}'):
            self.assertIsNone(trace_url(template, tid))

    def test_refresh_failure_never_advances_watermark(self):
        client = self.app()
        self.trigger(client)
        self.es.refresh = lambda **kwargs: {'_shards': {'failed': 1}}
        self.application.state.project_evidence()
        result = self.request(client, 'GET', self.path + '/diagnostics')['projection']
        self.assertEqual(result['status'], 'degraded')
        self.assertIsNone(result['indexed_revision'])
        self.assertIsNone(result['projected_at'])

    def test_conflict_compares_actual_content_even_when_stored_hash_is_unchanged(self):
        client = self.app()
        incident = self.trigger(client)
        self.application.state.project_evidence()
        event_id = incident['id'] + '-1'
        self.es.documents[event_id]['summary'] = 'corrupted evidence'
        self.projection.indexed_revision = None
        self.application.state.project_evidence()
        self.assertEqual(self.projection.failures,
                         [{'event_id': event_id, 'status': 409, 'code': 'content_conflict'}])

    def test_live_diagnostics_and_search_responses_validate_shared_schemas(self):
        from jsonschema import Draft202012Validator
        from backstage_api.contracts import CONTRACTS
        defs = json.loads((CONTRACTS / 'evidence.v1.schema.json').read_text())['$defs']
        client = self.app()
        self.trigger(client)
        self.application.state.project_evidence()
        for name, route in [('diagnostics', self.path + '/diagnostics'), ('search', '/evidence/search')]:
            result = self.request(client, 'GET', route)
            Draft202012Validator({'$defs': defs, '$ref': '#/$defs/' + name},
                                 format_checker=Draft202012Validator.FORMAT_CHECKER).validate(result)

    def test_immutable_event_summary_contains_recorded_room_family_and_referenced_count_facts(self):
        from backstage_api.evidence import event_documents
        client = self.app()
        incident = self.trigger(client)
        before = list(event_documents(self.application.state.runtime.snapshot()))
        raised = before[0]
        for term in ('Room B', 'room-b', 'overflow', 'door', 'cam-b', 'count 8', 'threshold 5'):
            self.assertIn(term, raised['summary'])
        self.approve(client, incident)
        after = list(event_documents(self.application.state.runtime.snapshot()))
        self.assertEqual(before, after[:3])
        self.assertTrue(all(len(document['summary']) <= 240 for document in after))

    def test_search_rejects_non_rfc3339_times_and_overlong_queries(self):
        client = self.app()
        self.trigger(client)
        self.request(client, 'GET', '/evidence/search?from=2026-11-09%2019:00:00Z', status=422)
        self.request(client, 'GET', '/evidence/search?q=' + 'x' * 201, status=422)
        self.request(client, 'GET', '/evidence/search?from=2026-11-10T19:00:00Z&to=2026-11-09T19:00:00Z', status=422)
