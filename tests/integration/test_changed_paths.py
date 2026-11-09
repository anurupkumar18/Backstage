"""Exercise the ownership check against actual Git diffs."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import TestCase


CHECK = Path(__file__).resolve().parents[2] / "scripts/check_changed_paths.py"


class ChangedPathsTests(TestCase):
    def check_path(self, path, *, author="anurupkumar18", branch="anurup/evidence", rename_to=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", directory, *args], stderr=subprocess.DEVNULL, text=True).strip()
            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (root / ".github").mkdir()
            (root / ".github/owners.json").write_text(json.dumps({
                "default_lane": "luke",
                "lanes": {
                    "luke": {"github_login": "lukeeskinner", "paths": []},
                    "kunj": {"github_login": "rathodkunj2005", "paths": ["apps/web/"]},
                },
                "contributors": {"anurup": {"github_login": "anurupkumar18", "paths": [
                    "apps/web/src/diagnostics/", "observability/", "apps/web/src/App.tsx"
                ]}},
            }))
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("before\n")
            git("add", ".")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")
            if rename_to:
                destination = root / rename_to
                destination.parent.mkdir(parents=True, exist_ok=True)
                target.rename(destination)
            else:
                target.write_text("after\n")
            git("add", "-A")
            git("commit", "-qm", "change")
            return subprocess.run([sys.executable, str(CHECK), "--base", base, "--head", "HEAD",
                                   "--author", author, "--branch", branch], cwd=root, capture_output=True, text=True)

    def test_authorized_contribution_does_not_replace_existing_owner(self):
        self.assertEqual(self.check_path("apps/web/src/diagnostics/Panel.tsx").returncode, 0)
        self.assertEqual(self.check_path("apps/web/src/diagnostics/Panel.tsx", author="rathodkunj2005", branch="kunj/ui").returncode, 0)

    def test_exact_file_grant_does_not_grant_similar_names(self):
        self.assertEqual(self.check_path("apps/web/src/App.tsx").returncode, 0)
        self.assertNotEqual(self.check_path("apps/web/src/App.tsx.backup").returncode, 0)

    def test_wrong_author_branch_and_ungranted_paths_are_denied(self):
        self.assertNotEqual(self.check_path("observability/README.md", author="someone-else").returncode, 0)
        self.assertNotEqual(self.check_path("observability/README.md", branch="unknown/evidence").returncode, 0)
        self.assertNotEqual(self.check_path("services/badge-simulator/server.py").returncode, 0)
        self.assertNotEqual(self.check_path(".github/workflows/scaffold.yml").returncode, 0)

    def test_rename_cannot_hide_ungranted_source(self):
        self.assertNotEqual(self.check_path("private/file.txt", rename_to="observability/file.txt").returncode, 0)

    def test_legacy_owner_is_preserved(self):
        self.assertEqual(self.check_path("README.md", author="lukeeskinner", branch="luke/docs").returncode, 0)
        self.assertNotEqual(self.check_path("apps/web/src/App.tsx", author="lukeeskinner", branch="luke/docs").returncode, 0)
