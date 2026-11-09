"""Serve static GET examples or smoke-test the same HTTP routes locally."""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
from urllib.request import urlopen

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "shared"


def read_examples():
    return json.loads((FIXTURES / "http.examples.json").read_text(encoding="utf-8"))


def handler_for(routes):
    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            response = routes.get(path)
            if response is None:
                self.send_error(404)
                return
            data = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return FixtureHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=("overflow", "stage_av", "badge_stall"), default="overflow")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    routes = {
        example["path"]: example["response"]
        for example in read_examples()
        if example["scenario"] == args.scenario and example["method"] == "GET" and example["status"] == 200
    }
    with ThreadingHTTPServer(("127.0.0.1", 0 if args.smoke else args.port), handler_for(routes)) as server:
        origin = f"http://127.0.0.1:{server.server_port}"
        if not args.smoke:
            print(f"Serving {args.scenario} fixtures at {origin}", flush=True)
            server.serve_forever()
            return
        thread = Thread(target=server.serve_forever)
        thread.start()
        try:
            for path, expected in routes.items():
                with urlopen(origin + path, timeout=5) as response:
                    if json.load(response) != expected:
                        raise ValueError(f"Unexpected fixture response for {path}")
        finally:
            server.shutdown()
            thread.join()
    print(f"{args.scenario}: {len(routes)} HTTP fixture routes passed.")


if __name__ == "__main__":
    main()
