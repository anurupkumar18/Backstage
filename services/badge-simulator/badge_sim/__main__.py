"""Command line for the badge simulator.

  python -m badge_sim serve              run by BADGE_ROLE: all (default), control, or station
  python -m badge_sim smoke [--split]    local A-to-B failover check (exit 0 on success);
                                         --split runs control and each station as separate apps
  python -m badge_sim seed|fault|recover|reset|state [--station station-a]
                                         drive a running `serve` (needs BADGE_ADMIN_ENABLED=true)

Run from services/badge-simulator/ so the `radar` package is importable.
"""

import argparse
import json
import logging
import os
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .config import Settings


def _admin(command, station_id):
    settings = Settings.from_env()
    base = os.environ.get("BADGE_CONTROL_URL", f"http://127.0.0.1:{settings.port}")
    method, data = ("GET", None) if command == "state" else ("POST", json.dumps({"station_id": station_id}).encode())
    request = Request(
        f"{base}/admin/{command}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {settings.internal_token}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            print(json.dumps(json.load(response), indent=2))
    except HTTPError as error:
        print(error.read().decode(), file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="badge_sim")
    parser.add_argument("command", choices=("serve", "smoke", "seed", "fault", "recover", "reset", "state"))
    parser.add_argument("--station", default="station-a")
    parser.add_argument("--split", action="store_true", help="smoke: run each station as its own app over HTTP")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s %(message)s"
    )

    if args.command == "smoke":
        from .smoke import run

        return run(split=args.split)
    if args.command != "serve":
        return _admin(args.command, args.station)

    from .server import build_app, serve

    settings = Settings.from_env()
    if not settings.internal_token:
        parser.error("BADGE_INTERNAL_TOKEN must be set")
    app = build_app(settings)
    app.start()
    server = serve(app, settings.host, settings.port)
    logging.info(
        "badge %s on http://%s:%s (station=%s store=%s radar=%s admin=%s)",
        settings.role, settings.host, settings.port, settings.station_id if settings.role == "station" else "-",
        settings.store, settings.radar_mode, settings.admin_enabled,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
