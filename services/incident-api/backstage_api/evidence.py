"""Rebuildable create-only event projection; checkpoint timelines remain authoritative."""

import hashlib
import json
import re
from contextlib import nullcontext
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from urllib.parse import parse_qsl, urlsplit

from opentelemetry import trace

from .engine import ApiError, MAX_DOOR_GAP, timestamp

MAX_AUTHORIZED_INCIDENTS = 1000
EVENT_TYPES = frozenset({'raise', 'claim', 'propose', 'approve', 'dispatch', 'ack', 'handoff',
                         'verify', 'close', 'escalate'})


def evidence_unavailable():
    return ApiError(503, 'evidence_unavailable', 'Searchable incident evidence is temporarily unavailable.')


def revision_view(revision):
    return {'seq_no': revision[0], 'primary_term': revision[1]} if revision is not None else None


def signal_ids(event):
    payload = event['payload']
    return ([payload['signal_id']] if 'signal_id' in payload else []) + payload.get('evidence_signal_ids', [])


def signal_view(signal_id, record):
    body, received_at, _incident_id = record
    result = {'signal_id': signal_id, 'kind': body['kind'], 'source_id': body['source_id'],
              'observed_at': body['occurred_at'], 'received_at': received_at, 'origin': 'unknown'}
    if body['kind'] == 'zone_count':
        result['facts'] = {name: body['data'][name] for name in ('zone', 'count', 'threshold')}
    return result


def content_hash(document):
    body = {key: value for key, value in document.items() if key != 'content_hash'}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def event_summary(incident, event, signals):
    family = 'badge_stall' if incident.get('badge') is not None else 'overflow'
    label = incident['room_id'].replace('-', ' ').title()
    summary = f"{label} ({incident['room_id']}) {family}: {event['type']} -> {event['state_to']}."
    for ref in signal_ids(event):
        if ref not in signals:
            continue
        body = signals[ref][0]
        summary += f" Signal {body['kind']} source {body['source_id']}"
        if body['kind'] == 'zone_count':
            facts = body['data']
            summary += f" {facts['zone']} count {facts['count']} threshold {facts['threshold']}"
        summary += '.'
    return summary[:240]


def event_documents(snapshot):
    state = snapshot.document()['state']
    signals = state['signals']
    for incident in state['incidents']:
        for event in incident['events']:
            refs = signal_ids(event)
            document = {
                'document_id': event['event_id'], 'kind': 'event', 'incident_id': incident['id'],
                'room_id': incident['room_id'], 'event_type': event['type'],
                'occurred_at': event['occurred_at'],
                'received_at': signals[refs[0]][1] if refs and refs[0] in signals else None,
                'summary': event_summary(incident, event, signals),
                'signal_id': refs[0] if len(refs) == 1 else None,
                'event_id': event['event_id'], 'sequence': event['sequence'],
                'trace_id': event['trace_id'], 'signal_ids': refs,
                'signals': [signal_view(ref, signals[ref]) for ref in refs if ref in signals],
                'origin': 'unknown',
            }
            document['content_hash'] = content_hash(document)
            yield document


def trace_url(template, trace_id):
    if not template or not trace_id or not re.fullmatch(r'(?!0{32}$)[a-f0-9]{32}', trace_id):
        return None
    if (len(template) > 2048 or re.search(r'[\x00-\x20\x7f]', template)
            or template.count('{trace_id}') != 1
            or re.search(r'[{}]', template.replace('{trace_id}', ''))):
        return None
    url = template.replace('{trace_id}', trace_id)
    try:
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
                or parts.fragment or parts.port is not None):
            return None
        if parts.hostname != 'dash0.com' and not parts.hostname.endswith('.dash0.com'):
            return None
        if not parts.query:
            return url
        # Dash0's documented trace explorer deep link. Keep its supported fields
        # narrow: no arbitrary filters, prompts, credentials, or opaque query blobs.
        if parts.path != '/goto/traces/explorer':
            return None
        pairs = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=True, max_num_fields=6)
        parameters = dict(pairs)
        if len(parameters) != len(pairs) or set(parameters) - {'trace_id', 'traceid', 'org', 'dataset', 'from', 'to'}:
            return None
        trace_keys = set(parameters) & {'trace_id', 'traceid'}
        if len(trace_keys) != 1 or parameters[next(iter(trace_keys))] != trace_id:
            return None
        # The placeholder must identify the trace, not an unrelated query value.
        if not re.search(r'(?:^|[?&])trace_?id=\{trace_id\}(?:&|$)', template):
            return None
        if 'org' in parameters and not re.fullmatch(
                r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', parameters['org']):
            return None
        if 'dataset' in parameters and not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', parameters['dataset']):
            return None
        for key in ('from', 'to'):
            if key not in parameters:
                continue
            value = parameters[key]
            if re.fullmatch(r'now(?:-[1-9]\d{0,5}(?:ms|s|m|h|d|w))?', value):
                continue
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)', value):
                return None
            datetime.fromisoformat(value)
        return url
    except ValueError:
        return None


class EvidenceProjection:
    def __init__(self, client, alias, tracer, telemetry=None):
        self.client, self.alias, self.tracer, self.telemetry = client, alias, tracer, telemetry
        self.indexed_revision = None
        self.indexed_versions = {}
        self.projected_at = None
        self.last_error = None
        self.failures = []
        self.project_lock = Lock()
        self.has_projected = False

    def freshness(self, snapshot, incident_id=None):
        current = self.has_projected and snapshot.revision == self.indexed_revision
        if snapshot.revision is None:
            versions = {item['id']: len(item['events']) for item in snapshot.document()['state']['incidents']}
            current = self.has_projected and versions == self.indexed_versions
        return {'status': 'degraded' if self.last_error else 'current' if current else 'pending',
                'checkpoint_revision': revision_view(snapshot.revision),
                'indexed_revision': revision_view(self.indexed_revision),
                'watermark_version': self.indexed_versions.get(incident_id) if incident_id else None,
                'projected_at': self.projected_at, 'last_error': self.last_error}

    def project(self, snapshot):
        # Runtime has already copied and released its lock before any Elasticsearch I/O.
        with self.project_lock:
            if self.freshness(snapshot)['status'] == 'current':
                return
            started, outcome = monotonic(), 'error'
            failures = []
            try:
                documents = list(event_documents(snapshot))
                for offset in range(0, len(documents), 100):
                    chunk = documents[offset:offset + 100]
                    operations = []
                    for document in chunk:
                        operations.extend([{'create': {'_id': document['event_id']}}, document])
                    with self.telemetry.es_operation('project') if self.telemetry else nullcontext():
                        result = self.client.bulk(index=self.alias, operations=operations, require_alias=True,
                                                  refresh=False)
                    items = result['items']
                    if len(items) != len(chunk):
                        raise ValueError('Unexpected bulk response length')
                    for document, item in zip(chunk, items):
                        entry = item.get('create', {})
                        status = entry.get('status', 0)
                        code = None
                        if entry.get('_id') != document['event_id']:
                            code = 'unexpected_item'
                        elif status == 409:
                            with self.telemetry.es_operation('project') if self.telemetry else nullcontext():
                                existing = self.client.get(index=self.alias, id=document['event_id'])['_source']
                            if (existing.get('content_hash') != document['content_hash']
                                    or content_hash(existing) != document['content_hash']):
                                code = 'content_conflict'
                        elif status not in (200, 201):
                            code = 'item_failed'
                        if code:
                            failures.append({'event_id': document['event_id'], 'status': status, 'code': code})
                        if self.telemetry:
                            self.telemetry.count('backstage.evidence.documents',
                                                 {'kind': 'event', 'outcome': 'error' if code else 'success'})
                if failures:
                    self.failures, self.last_error = failures, 'projection_item_failure'
                    return
                with self.telemetry.es_operation('project') if self.telemetry else nullcontext():
                    refreshed = self.client.indices.refresh(index=self.alias)
                if refreshed['_shards']['failed'] != 0:
                    raise ValueError('Refresh failed')
                # All creates/conflicts are verified and refresh acknowledged before advancing coverage.
                self.indexed_versions = {item['id']: len(item['events'])
                                         for item in snapshot.document()['state']['incidents']}
                self.indexed_revision = snapshot.revision
                self.projected_at = timestamp(datetime.now(timezone.utc))
                self.has_projected = True
                self.failures, self.last_error = [], None
                outcome = 'success'
            except Exception:
                self.failures = failures
                self.last_error = 'projection_unavailable'
            finally:
                if self.telemetry:
                    self.telemetry.duration('backstage.evidence.projection.duration', monotonic() - started,
                                            {'outcome': outcome})
                    self.telemetry.event('evidence.projection', outcome=outcome, count=len(failures))

    def search(self, authorized_ids, *, q, room_id, event_type, from_at, to_at, limit):
        if len(authorized_ids) > MAX_AUTHORIZED_INCIDENTS:
            raise evidence_unavailable()
        if not authorized_ids:
            return []
        filters = [{'terms': {'incident_id': authorized_ids}}]
        if room_id:
            filters.append({'term': {'room_id': room_id}})
        if event_type:
            filters.append({'term': {'event_type': event_type}})
        bounds = {key: value for key, value in (('gte', from_at), ('lte', to_at)) if value}
        if bounds:
            filters.append({'range': {'occurred_at': bounds}})
        query = {'bool': {'filter': filters}}
        if q:
            query['bool']['must'] = [{'multi_match': {'query': q, 'fields': ['summary'], 'operator': 'and'}}]
        started, outcome = monotonic(), 'error'
        try:
            with self.telemetry.es_operation('search') if self.telemetry else nullcontext():
                response = self.client.search(index=self.alias, query=query, size=limit,
                                               sort=[{'occurred_at': 'desc'}, {'event_id': 'asc'}],
                                               track_total_hits=False, timeout='2s')
            if response.get('timed_out') or response.get('_shards', {}).get('failed', 0):
                raise evidence_unavailable()
            hits = response['hits']['hits']
            if not isinstance(hits, list):
                raise ValueError('Unexpected hits')
            outcome = 'success'
            return hits[:limit]
        except Exception as error:
            raise evidence_unavailable() from error
        finally:
            if self.telemetry:
                self.telemetry.duration('backstage.evidence.search.duration', monotonic() - started,
                                        {'outcome': outcome})


def diagnostics(snapshot, incident_id, actor, projection, now, link_template=None, durable=False):
    from .persistence import restore_store
    # Use the exact committed snapshot (not a live mutable aggregate) for all fields.
    store = restore_store(trace.get_tracer('backstage.diagnostics'), snapshot.document())
    incident = store.read(incident_id, actor)
    events = incident.events
    refs = {ref for event in events for ref in signal_ids(event)}
    signals = snapshot.document()['state']['signals']
    associated = [(key, value) for key, value in signals.items()
                  if value[2] == incident_id or key in refs]
    associated.sort(key=lambda pair: (pair[1][1], pair[0]))
    samples = incident.clear_samples
    fresh = bool(samples and now - samples[-1][0] <= MAX_DOOR_GAP)
    duration = max(0, (samples[-1][0] - samples[0][0]).total_seconds()) if samples and (fresh or incident.state == 'resolved') else 0
    if incident.state == 'resolved':
        reason = 'Committed recovery evidence passed verification.'
    elif incident.state in {'detected', 'triaged'}:
        reason = 'Waiting for a proposed plan and organizer approval before staff acceptance.'
    elif incident.state == 'plan_proposed':
        reason = 'Waiting for organizer approval before dispatch and staff acceptance.'
    elif incident.state == 'approved':
        reason = 'Waiting for assignment and staff acceptance before recovery verification.'
    elif incident.state == 'dispatched':
        reason = 'Waiting for the assigned staff member to accept before recovery verification.'
    elif incident.state == 'escalated':
        reason = 'Recovery is escalated because no eligible staff remain; further action is required.'
    elif incident.badge is not None:
        reason = 'Waiting for all affected jobs and matching PDF completion evidence.'
    elif not fresh:
        reason = 'Waiting for fresh below-threshold door evidence; stale samples reset the window.'
    else:
        reason = 'Waiting for 60 seconds of continuous fresh below-threshold door evidence.'
    disabled = {'status': 'disabled', 'checkpoint_revision': revision_view(snapshot.revision),
                'indexed_revision': None, 'watermark_version': None, 'projected_at': None, 'last_error': None}
    return {'incident_id': incident_id, 'version': len(events),
            'storage': {'mode': 'elasticsearch' if durable else 'memory', 'durable': durable},
            'provenance': {'origin': 'unknown'},
            'verification': {'status': 'passed' if incident.state == 'resolved' else 'pending',
                             'reason': reason, 'required_duration_s': 60 if incident.badge is None else None,
                             'observed_duration_s': duration if incident.badge is None else None,
                             'evidence_signal_ids': signal_ids(events[-1]) if incident.state == 'resolved'
                             else [sid for _, sid in samples] if fresh else []},
            'signals': [signal_view(key, value) for key, value in associated],
            'events': [{'event_id': event['event_id'], 'sequence': event['sequence'], 'type': event['type'],
                        'occurred_at': event['occurred_at'], 'signal_ids': signal_ids(event)} for event in events],
            'projection': projection.freshness(snapshot, incident_id) if projection else disabled,
            'trace': {'trace_id': incident.trace_id, 'url': trace_url(link_template, incident.trace_id)}}
