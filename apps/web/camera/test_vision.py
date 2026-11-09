import http.client
import json
import threading
import unittest
from vision import make_server


class FakeDetector:
    name = 'test-detector'
    calls = 0

    def detect(self, frame):
        self.calls += 1
        return {'model': self.name, 'boxes': [], 'inference_ms': 1}


class PreviewBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.detector = FakeDetector()
        self.server = make_server(self.detector, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()

    def request(self, method, path, body=None, headers=None):
        self.connection.request(method, path, body=body, headers=headers or {})
        response = self.connection.getresponse()
        data = json.loads(response.read())
        return response, data

    def test_loopback_health_is_metadata_only_and_not_cached(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        response, data = self.request('GET', '/healthz')
        self.assertEqual(response.status, 200)
        self.assertEqual(data, {'status': 'ready', 'model': 'test-detector'})
        self.assertEqual(response.getheader('Cache-Control'), 'no-store')
        self.assertIsNone(response.getheader('Access-Control-Allow-Origin'))

    def test_untrusted_and_non_image_requests_never_reach_detector(self):
        for headers, expected in [({}, 403), ({'X-Backstage-Vision': '1', 'Content-Type': 'text/plain'}, 415), ({'X-Backstage-Vision': '1', 'Content-Type': 'image/jpeg'}, 422)]:
            response, _ = self.request('POST', '/detect', b'invalid', headers)
            self.assertEqual(response.status, expected)
        self.assertEqual(self.detector.calls, 0)

    def test_oversized_upload_fails_before_read_or_inference(self):
        response, _ = self.request('POST', '/detect', b'', {'Content-Length': '1000001', 'Content-Type': 'image/jpeg', 'X-Backstage-Vision': '1'})
        self.assertEqual(response.status, 413)
        self.assertEqual(self.detector.calls, 0)

    def test_valid_frame_returns_counts_metadata_not_the_frame(self):
        import cv2
        import numpy as np
        _, jpeg = cv2.imencode('.jpg', np.zeros((32, 32, 3), dtype=np.uint8))
        response, data = self.request('POST', '/detect', jpeg.tobytes(), {'Content-Type': 'image/jpeg', 'X-Backstage-Vision': '1'})
        self.assertEqual(response.status, 200)
        self.assertEqual(set(data), {'model', 'boxes', 'inference_ms'})
        self.assertEqual(self.detector.calls, 1)


if __name__ == '__main__':
    unittest.main()
