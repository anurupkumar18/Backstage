#!/usr/bin/env python3
"""Provision one explicit incident evidence prefix; never read a credential file."""
import argparse
import json
import os
import re
from pathlib import Path
from elasticsearch import Elasticsearch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', args.prefix):
        parser.error('prefix must be a lowercase Elasticsearch index prefix')
    if not os.getenv('ELASTICSEARCH_URL') or not os.getenv('ELASTICSEARCH_API_KEY'):
        parser.error('ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY must be configured in the environment')
    alias = args.prefix + '-incident-evidence'
    index = alias + '-v1'
    definition = json.loads(Path(__file__).with_name('incident-evidence-v1.json').read_text())
    definition['aliases'] = {alias: {'is_write_index': True}}
    with Elasticsearch(os.environ['ELASTICSEARCH_URL'], api_key=os.environ['ELASTICSEARCH_API_KEY'],
                       request_timeout=5, max_retries=0) as client:
        if client.indices.exists_alias(name=alias):
            raise SystemExit('Evidence alias already exists; inspect its mapping before using it. No changes made.')
        result = client.indices.create(index=index, **definition)
        if not result.get('acknowledged'):
            raise SystemExit('Index creation was not acknowledged. Inspect the alias before retrying.')
    print(json.dumps({'index': index, 'alias': alias, 'acknowledged': True}))


if __name__ == '__main__':
    main()
