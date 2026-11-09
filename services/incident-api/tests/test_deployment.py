"""Exercise the ASGI entrypoint used by the actual deployment manifest."""
import os
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import yaml
from uvicorn import Config


class DeploymentStartupTests(TestCase):
    def test_manifest_loads_asgi_factory(self):
        root = Path(__file__).resolve().parents[3]
        resources = list(yaml.safe_load_all((root / 'deploy/incident/incident-api.yaml').read_text()))
        deployment = next(item for item in resources if item['kind'] == 'Deployment')
        command = deployment['spec']['template']['spec']['containers'][0]['command']
        entrypoint = command[command.index('uvicorn') + 1]
        self.assertIn('--factory', command)
        with patch.dict(os.environ, {'APP_MODE': 'mock', 'AUTH_TOKENS_JSON': '{}'}):
            config = Config(entrypoint, factory='--factory' in command, log_config=None)
            config.load()
        self.assertTrue(config.loaded)
        self.assertTrue(callable(config.loaded_app))
