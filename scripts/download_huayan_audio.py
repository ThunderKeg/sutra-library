#!/usr/bin/env python3
"""Download the external Huayan audio tracks with resumable byte ranges."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import shutil
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://wz.yyxcfg.com/a/a/4"
TRACKS = tuple(range(1012, 1022))
CHUNK_SIZE = 2 * 1024 * 1024


def remote_size(url: str) -> int:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "sutra-library-audio-align/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return int(response.headers["Content-Length"])


def download_part(url: str, part_path: Path, start: int, end: int) -> None:
    expected = end - start + 1
    if part_path.exists() and part_path.stat().st_size == expected:
        return
    for attempt in range(1, 5):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "Range": f"bytes={start}-{end}",
                    "User-Agent": "sutra-library-audio-align/1",
                },
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = response.read()
                if response.status != 206 or len(payload) != expected:
                    raise RuntimeError(f"range {start}-{end}: HTTP {response.status}, {len(payload)} bytes")
            part_path.write_bytes(payload)
            return
        except Exception:
            if attempt == 4:
                raise
            time.sleep(attempt * 1.5)


def download_track(track: int, destination: Path, workers: int) -> None:
    url = f"{BASE_URL}/{track}.m4a"
    output = destination / f"{track}.m4a"
    size = remote_size(url)
    if output.exists() and output.stat().st_size == size:
        print(f"{track}: already complete ({size} bytes)", flush=True)
        return

    part_dir = destination / ".parts" / str(track)
    part_dir.mkdir(parents=True, exist_ok=True)
    ranges = [
        (index, start, min(size - 1, start + CHUNK_SIZE - 1))
        for index, start in enumerate(range(0, size, CHUNK_SIZE))
    ]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(download_part, url, part_dir / f"{index:04d}.part", start, end): index
            for index, start, end in ranges
        }
        completed = 0
        for future in as_completed(futures):
            future.result()
            completed += 1
            print(f"{track}: {completed}/{len(ranges)} ranges", flush=True)

    temporary = output.with_suffix(".m4a.tmp")
    with temporary.open("wb") as target:
        for index, _start, _end in ranges:
            with (part_dir / f"{index:04d}.part").open("rb") as source:
                shutil.copyfileobj(source, target)
    if temporary.stat().st_size != size:
        raise RuntimeError(f"{track}: assembled size mismatch")
    temporary.replace(output)
    shutil.rmtree(part_dir)
    print(f"{track}: complete ({size} bytes)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path, default=ROOT / "sources/audio/huayan-01")
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    args.destination.mkdir(parents=True, exist_ok=True)
    for track in TRACKS:
        download_track(track, args.destination, max(1, args.workers))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
