#!/usr/bin/env python3
"""Backstage agent message board: append-only JSONL messages shared through the agent-board git branch."""

from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BRANCH = "agent-board"
LANES = ("kunj", "luke", "ali", "edge")
KINDS = ("info", "request", "decision", "blocker", "answer")
MAX_BODY = 4000
PUSH_ATTEMPTS = 5
AGENT_ID = re.compile(r"^(kunj|luke|ali|edge)(-[a-z0-9]+)+$")
SECRET_PATTERNS = (
    r"sk-[A-Za-z0-9_-]{16,}",
    r"gh[pousr]_[A-Za-z0-9]{20,}",
    r"AKIA[0-9A-Z]{16}",
    r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{20,}",
    r"(?i)(token|secret|api[_-]?key|password)\s*[=:]\s*\S{12,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
)


class BoardError(Exception):
    pass


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise BoardError(f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result


def lane_of(agent: str) -> str:
    return agent.split("-", 1)[0]


def validate_agent(agent: str) -> None:
    if not AGENT_ID.match(agent):
        raise BoardError(f"Agent id {agent!r} must look like <lane>-<name>, lane in {', '.join(LANES)} (e.g. luke-codex).")


def validate_recipients(recipients: list[str]) -> None:
    if not recipients:
        raise BoardError("Give at least one recipient: a lane, an agent id, or 'all'.")
    for recipient in recipients:
        if recipient != "all" and recipient not in LANES and not AGENT_ID.match(recipient):
            raise BoardError(f"Unknown recipient {recipient!r}.")


def refuse_secrets(text: str) -> None:
    for pattern in SECRET_PATTERNS:
        if re.search(pattern, text):
            raise BoardError("Message looks like it contains a credential. This board is public, so nothing was posted.")


def sync(root: Path) -> None:
    fetched = git(root, "fetch", "origin", BRANCH, check=False)
    if fetched.returncode != 0:
        if "couldn't find remote ref" in fetched.stderr:
            return
        raise BoardError(f"git fetch failed: {fetched.stderr.strip()}")
    if git(root, "rev-parse", "--verify", "-q", "HEAD", check=False).returncode != 0:
        git(root, "checkout", "-q", "-B", BRANCH, f"origin/{BRANCH}")
        return
    git(root, "rebase", f"origin/{BRANCH}", check=False)
    if git(root, "status", "--porcelain", "--untracked-files=no").stdout.strip():
        git(root, "rebase", "--abort", check=False)
        raise BoardError("Board checkout has local changes that conflict with the remote. Resolve in the board directory.")


def load_messages(root: Path) -> list[dict]:
    messages: list[dict] = []
    for path in sorted((root / "messages").glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return sorted(messages, key=lambda message: (message.get("ts", ""), message.get("id", "")))


def addressed_to(message: dict, agent: str) -> bool:
    recipients = set(message.get("to", []))
    return message.get("from") != agent and bool(recipients & {"all", lane_of(agent), agent})


def format_message(message: dict) -> str:
    header = f"[{message['ts']}] {message['id']}  {message['from']} -> {','.join(message['to'])}  ({message['kind']})"
    if message.get("topic"):
        header += f"  #{message['topic']}"
    if message.get("reply_to"):
        header += f"  re:{message['reply_to']}"
    lines = [header, *("  " + line for line in message["body"].splitlines())]
    if message.get("refs"):
        lines.append("  refs: " + ", ".join(message["refs"]))
    return "\n".join(lines)


def state_path(root: Path, agent: str) -> Path:
    return root / ".git" / f"board-state-{agent}.json"


def seen_ids(root: Path, agent: str) -> set[str]:
    path = state_path(root, agent)
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")).get("seen", []))
    except (json.JSONDecodeError, OSError):
        return set()


def mark_seen(root: Path, agent: str, ids: set[str]) -> None:
    state_path(root, agent).write_text(json.dumps({"seen": sorted(ids)}), encoding="utf-8")


def post(
    root: Path,
    sender: str,
    recipients: list[str],
    body: str,
    kind: str = "info",
    topic: str | None = None,
    reply_to: str | None = None,
    refs: list[str] | None = None,
) -> dict:
    validate_agent(sender)
    validate_recipients(recipients)
    if kind not in KINDS:
        raise BoardError(f"kind must be one of {', '.join(KINDS)}.")
    body = body.strip()
    if not body:
        raise BoardError("Message body is empty.")
    if len(body) > MAX_BODY:
        raise BoardError(f"Message body is {len(body)} characters; the limit is {MAX_BODY}. Link to a repo doc instead.")
    refuse_secrets(body)
    refuse_secrets(" ".join(refs or []))

    sync(root)
    message = {
        "id": f"{sender}-{int(time.time() * 1000)}-{secrets.token_hex(2)}",
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "from": sender,
        "to": recipients,
        "kind": kind,
        "topic": topic,
        "reply_to": reply_to,
        "body": body,
        "refs": refs or [],
    }
    path = root / "messages" / f"{sender}.jsonl"
    path.parent.mkdir(exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(message, ensure_ascii=False) + "\n")
    git(root, "add", str(path.relative_to(root)))
    subject = f"board: {sender} -> {','.join(recipients)} [{kind}]" + (f" {topic}" if topic else "")
    git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", subject)

    for attempt in range(1, PUSH_ATTEMPTS + 1):
        pushed = git(root, "push", "origin", f"HEAD:{BRANCH}", check=False)
        if pushed.returncode == 0:
            return message
        if attempt == PUSH_ATTEMPTS:
            raise BoardError(f"Push failed after {PUSH_ATTEMPTS} attempts: {pushed.stderr.strip()}")
        time.sleep(0.2 * attempt)
        sync(root)
    return message


def cmd_post(args: argparse.Namespace) -> None:
    body = sys.stdin.read() if args.body == "-" else args.body
    recipients = [part for part in args.to.split(",") if part]
    message = post(args.root, args.sender, recipients, body, args.kind, args.topic, args.reply_to, args.ref)
    print(f"posted {message['id']}")


def cmd_read(args: argparse.Namespace) -> None:
    if not args.no_sync:
        sync(args.root)
    messages = load_messages(args.root)
    if args.topic:
        messages = [message for message in messages if message.get("topic") == args.topic]
    if args.sender:
        messages = [message for message in messages if message["from"] == args.sender or lane_of(message["from"]) == args.sender]
    if args.limit:
        messages = messages[-args.limit :]
    print("\n".join(json.dumps(message) for message in messages) if args.json else "\n\n".join(map(format_message, messages)))


def cmd_inbox(args: argparse.Namespace) -> None:
    validate_agent(args.agent)
    if not args.no_sync:
        sync(args.root)
    seen = seen_ids(args.root, args.agent)
    mine = [message for message in load_messages(args.root) if addressed_to(message, args.agent)]
    unread = mine if args.all else [message for message in mine if message["id"] not in seen]
    if not unread:
        print("No unread messages.")
        return
    print("\n\n".join(map(format_message, unread)))
    mark_seen(args.root, args.agent, seen | {message["id"] for message in unread})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", dest="root", type=Path, default=Path(__file__).resolve().parent, help="board checkout (default: this script's directory)")
    sub = parser.add_subparsers(dest="command", required=True)

    post_parser = sub.add_parser("post", help="append a message and push it")
    post_parser.add_argument("--from", dest="sender", required=True, help="your agent id, e.g. kunj-claude")
    post_parser.add_argument("--to", required=True, help="comma list of lanes (kunj,luke,ali,edge), agent ids, or all")
    post_parser.add_argument("--kind", default="info", choices=KINDS)
    post_parser.add_argument("--topic")
    post_parser.add_argument("--reply-to")
    post_parser.add_argument("--ref", action="append", default=[], help="commit, path, PR or log entry (repeatable)")
    post_parser.add_argument("body", help="message text, or - to read stdin")
    post_parser.set_defaults(func=cmd_post)

    read_parser = sub.add_parser("read", help="print messages")
    read_parser.add_argument("--topic")
    read_parser.add_argument("--from", dest="sender", help="agent id or lane")
    read_parser.add_argument("--limit", type=int, default=0, help="only the latest N")
    read_parser.add_argument("--json", action="store_true")
    read_parser.add_argument("--no-sync", action="store_true")
    read_parser.set_defaults(func=cmd_read)

    inbox_parser = sub.add_parser("inbox", help="print unread messages addressed to you, then mark them read")
    inbox_parser.add_argument("--as", dest="agent", required=True, help="your agent id")
    inbox_parser.add_argument("--all", action="store_true", help="include messages already read")
    inbox_parser.add_argument("--no-sync", action="store_true")
    inbox_parser.set_defaults(func=cmd_inbox)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except BoardError as error:
        print(f"board: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
