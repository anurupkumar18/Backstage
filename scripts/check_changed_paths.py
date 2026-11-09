"""Check the PR author's assigned lane against the base branch's ownership map."""

import argparse
import json
import subprocess
from pathlib import Path


def changed_paths(base, head):
    output = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}", "--"]
    )
    return [path.decode("utf-8", "surrogateescape") for path in output.split(b"\0") if path]


def owner_for(path, owners):
    return next(
        (
            lane
            for lane, settings in owners["lanes"].items()
            if any(path.startswith(prefix) for prefix in settings["paths"])
        ),
        owners["default_lane"],
    )


def main():
    parser = argparse.ArgumentParser()
    for name in ("base", "head", "author", "branch"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    owners = json.loads(Path(".github/owners.json").read_text(encoding="utf-8"))
    lane, _, feature = args.branch.partition("/")
    settings = owners["lanes"].get(lane)
    if not feature or not settings or not settings["github_login"]:
        parser.exit(1, f"Branch {args.branch!r} has no active ownership lane.\n")
    if args.author.casefold() != settings["github_login"].casefold():
        parser.exit(1, f"{args.author!r} is not assigned to the {lane!r} lane.\n")
    rejected = [
        path for path in changed_paths(args.base, args.head) if owner_for(path, owners) != lane
    ]
    if rejected:
        parser.exit(1, "Paths outside the assigned lane:\n" + "\n".join(map(repr, rejected)) + "\n")
    print(f"Changed paths are within the {lane} lane.")


if __name__ == "__main__":
    main()
