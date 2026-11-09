"""Local, memory-only YOLO preview and reproducible clip annotations. No incident writes."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import time

MAX_FRAME_BYTES = 1_000_000


class Detector:
    def __init__(self, model_path):
        path = Path(model_path).resolve()
        if not path.is_file():
            raise ValueError('Supply an existing local model; automatic downloads are disabled.')
        os.environ.setdefault('YOLO_OFFLINE', '1')
        os.environ.setdefault('YOLO_VERBOSE', 'False')
        from ultralytics import YOLO
        from ultralytics.utils import SETTINGS
        SETTINGS.update({"sync": False})
        self.model = YOLO(str(path))
        self.name = path.name
        self.lock = threading.Lock()

    def detect(self, frame):
        height, width = frame.shape[:2]
        started = time.perf_counter()
        with self.lock:
            result = self.model.predict(frame, classes=[0], conf=0.35, imgsz=640,
                                        device='cpu', verbose=False, save=False)[0]
        boxes = []
        for box in result.boxes:
            coords = box.xyxy[0].tolist()
            boxes.append({'box': [round(max(0, min(1, value / (width if i % 2 == 0 else height))), 5)
                                  for i, value in enumerate(coords)],
                          'confidence': round(float(box.conf[0]), 3)})
        return {'boxes': boxes, 'inference_ms': round((time.perf_counter() - started) * 1000),
                'model': self.name}


def annotate(detector, video_path, output_path, fps=4):
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError('Cannot decode clip.')
    frames = []
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
    try:
        for n in range(int(duration * fps)):
            at = n / fps
            cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
            ok, frame = cap.read()
            if not ok:
                raise ValueError(f'Cannot decode frame at {at}.')
            result = detector.detect(frame)
            frames.append({'at': at, 'boxes': result['boxes']})
    finally:
        cap.release()
    output = {'model': detector.name, 'confidence_floor': 0.35, 'sample_fps': fps,
              'duration': duration, 'source': 'YOLO inference on prerecorded conference clip',
              'frames': frames}
    Path(output_path).write_text(json.dumps(output, separators=(',', ':')))
    print(f'Annotated {len(frames)} samples; maximum {max(len(f["boxes"]) for f in frames)} people.')


def make_server(detector, port):
    import cv2
    import numpy as np

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != '/healthz':
                return self.send(404, {'error': 'Not found'})
            self.send(200, {'status': 'ready', 'model': detector.name})

        def do_POST(self):
            # Loopback socket + explicit same-origin proxy header, with no permissive CORS.
            if self.path != '/detect' or self.headers.get('X-Backstage-Vision') != '1':
                return self.send(403, {'error': 'Use the local Backstage video page.'})
            if self.headers.get('Content-Type') != 'image/jpeg':
                return self.send(415, {'error': 'Send JPEG frames only.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                return self.send(400, {'error': 'Invalid length.'})
            if not 0 < length <= MAX_FRAME_BYTES:
                return self.send(413, {'error': 'Frame must be at most 1 MB.'})
            if not slots.acquire(blocking=False):
                return self.send(429, {'error': 'Detector busy; try the next frame.'})
            try:
                data = self.rfile.read(length)
                frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
                if frame is None or max(frame.shape[:2]) > 1280:
                    return self.send(422, {'error': 'Invalid or oversized frame.'})
                result = detector.detect(frame)
                self.send(200, result)
            except Exception:
                self.send(500, {'error': 'Detection failed.'})
            finally:
                slots.release()

    slots = threading.BoundedSemaphore(1)
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def serve(detector, port):
    server = make_server(detector, port)
    print(f'YOLO preview on 127.0.0.1:{port}; frames stay in memory.', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--video')
    parser.add_argument('--output')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    detector = Detector(args.model)
    if args.video:
        if not args.output:
            parser.error('--video requires --output')
        annotate(detector, args.video, args.output)
    else:
        serve(detector, args.port)
