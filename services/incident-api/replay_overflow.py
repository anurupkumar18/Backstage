"""Replay the shared count fixtures against the running local API in real time."""

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic, sleep
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import uuid4

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "shared" / "overflow.signals.jsonl"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("trigger", "clear"))
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    args = parser.parse_args()
    token = os.getenv("CAM_SIGNAL_TOKEN")
    if not token:
        parser.error("Set CAM_SIGNAL_TOKEN before starting the replay.")

    signals = [json.loads(line) for line in FIXTURE.read_text(encoding="utf-8").splitlines()]
    selected = signals[:4] if args.phase == "trigger" else signals[5:]
    start = datetime.fromisoformat(selected[0]["occurred_at"])
    wall_start = datetime.now(timezone.utc)
    schedule_start = monotonic()
    run_id = uuid4().hex[:12]
    for signal in selected:
        offset = (datetime.fromisoformat(signal["occurred_at"]) - start).total_seconds()
        sleep(max(0, schedule_start + offset - monotonic()))
        signal["signal_id"] = f"{signal['signal_id']}-{run_id}"
        signal["occurred_at"] = (wall_start + timedelta(seconds=offset)).isoformat().replace("+00:00", "Z")
        request = Request(
            args.base_url.rstrip("/") + "/signals",
            data=json.dumps(signal).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=5) as response:
                print(response.read().decode(), flush=True)
        except URLError as error:
            parser.exit(1, f"Replay stopped at {signal['signal_id']}: {error}\n")


if __name__ == "__main__":
    main()
