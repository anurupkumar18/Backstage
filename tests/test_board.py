import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import board  # noqa: E402


def run(*args: str, cwd: Path | None = None) -> None:
    subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)


class BoardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.remote = base / "remote.git"
        run("git", "init", "--bare", "-q", str(self.remote))

    def clone(self, name: str) -> Path:
        path = Path(self.tmp.name) / name
        run("git", "clone", "-q", str(self.remote), str(path))
        try:
            run("git", "checkout", "-q", "-B", board.BRANCH, f"origin/{board.BRANCH}", cwd=path)
        except subprocess.CalledProcessError:
            run("git", "checkout", "-q", "-B", board.BRANCH, cwd=path)
        run("git", "config", "user.email", f"{name}@example.test", cwd=path)
        run("git", "config", "user.name", name, cwd=path)
        return path

    def test_first_post_creates_branch_and_other_clone_receives_it(self) -> None:
        kunj = self.clone("kunj")
        luke = self.clone("luke")
        message = board.post(kunj, "kunj-claude", ["luke"], "Room labels need a venue pass.", "request", "labels", refs=["docs/x.md"])

        board.sync(luke)
        inbox = [m for m in board.load_messages(luke) if board.addressed_to(m, "luke-codex")]
        self.assertEqual([m["id"] for m in inbox], [message["id"]])
        self.assertIn("refs: docs/x.md", board.format_message(inbox[0]))

    def test_inbox_marks_read_and_second_call_is_empty(self) -> None:
        kunj = self.clone("kunj")
        board.post(kunj, "kunj-claude", ["all"], "hello", "info")
        luke = self.clone("luke")
        seen = board.seen_ids(luke, "luke-codex")
        mine = [m for m in board.load_messages(luke) if board.addressed_to(m, "luke-codex")]
        self.assertEqual(len(mine), 1)
        board.mark_seen(luke, "luke-codex", seen | {m["id"] for m in mine})
        self.assertEqual(board.seen_ids(luke, "luke-codex"), {mine[0]["id"]})

    def test_addressing_by_lane_agent_all_and_never_to_self(self) -> None:
        message = {"from": "kunj-ui", "to": ["luke", "ali-agents"]}
        self.assertTrue(board.addressed_to(message, "luke-codex"))
        self.assertTrue(board.addressed_to(message, "ali-agents"))
        self.assertFalse(board.addressed_to(message, "ali-other"))
        self.assertFalse(board.addressed_to({"from": "kunj-ui", "to": ["all"]}, "kunj-ui"))
        self.assertTrue(board.addressed_to({"from": "kunj-ui", "to": ["all"]}, "kunj-ops"))

    def test_refuses_credentials_bad_ids_and_oversized_bodies(self) -> None:
        kunj = self.clone("kunj")
        for body in ("key sk-abcdefghijklmnopqrstuv", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "DASH0_AUTH_TOKEN=abcdefghijklmnop"):
            with self.assertRaises(board.BoardError):
                board.post(kunj, "kunj-claude", ["luke"], body)
        with self.assertRaises(board.BoardError):
            board.post(kunj, "claude", ["luke"], "hi")
        with self.assertRaises(board.BoardError):
            board.post(kunj, "kunj-claude", ["nobody"], "hi")
        with self.assertRaises(board.BoardError):
            board.post(kunj, "kunj-claude", ["luke"], "x" * (board.MAX_BODY + 1))
        self.assertEqual(board.load_messages(kunj), [])

    def test_concurrent_posters_all_land_and_none_are_lost(self) -> None:
        kunj = self.clone("kunj")
        board.post(kunj, "kunj-claude", ["all"], "seed")
        luke = self.clone("luke")
        errors: list[Exception] = []

        def poster(root: Path, sender: str) -> None:
            try:
                for index in range(4):
                    board.post(root, sender, ["all"], f"{sender} message {index}")
            except Exception as error:
                errors.append(error)

        threads = [
            threading.Thread(target=poster, args=(kunj, "kunj-claude")),
            threading.Thread(target=poster, args=(luke, "luke-codex")),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])

        reader = self.clone("reader")
        bodies = {m["body"] for m in board.load_messages(reader)}
        expected = {f"{sender} message {i}" for sender in ("kunj-claude", "luke-codex") for i in range(4)}
        self.assertTrue(expected <= bodies, expected - bodies)


if __name__ == "__main__":
    unittest.main()
