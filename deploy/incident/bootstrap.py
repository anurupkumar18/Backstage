"""Fetch the pinned API runtime and install its dependencies in a shared volume."""
import io
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import urllib.request


def extract_runtime(data, target):
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts[1:]
            if not member.isfile() or not parts or ".." in parts:
                continue
            relative = PurePosixPath(*parts)
            name = str(relative)
            if not (name.startswith("contracts/") or
                    name.startswith("services/incident-api/backstage_api/") or
                    name == "services/incident-api/requirements.txt"):
                continue
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
            count += 1
    if not (target / "services/incident-api/backstage_api/main.py").is_file():
        raise RuntimeError("Pinned archive is missing the incident API")
    return count


def main():
    sha = os.environ["CODE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("CODE_SHA must be a full commit SHA")
    target = Path("/runtime/repo")
    with urllib.request.urlopen(
        f"https://codeload.github.com/lukeeskinner/Backstage/tar.gz/{sha}", timeout=60
    ) as response:
        count = extract_runtime(response.read(), target)
    subprocess.run([
        sys.executable, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check",
        "--target", "/runtime/python", "-r", str(target / "services/incident-api/requirements.txt"),
    ], check=True)
    print(f"Prepared {count} runtime files at {sha}")


if __name__ == "__main__":
    main()
