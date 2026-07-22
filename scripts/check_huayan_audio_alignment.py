#!/usr/bin/env python3
"""Independently audit Huayan volume-one page/audio alignment metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
ALIGNMENT_PATH = ROOT / "data/huayan/volume-01-audio-alignment.json"
INDEX_PATH = ROOT / "data/huayan/volume-01-index.json"
BODY_PATHSPEC = ("data/huayan/volume-01-index.json", "data/huayan/volume-01")
TRACK_SECTIONS = {
    "1012": ("juan-01",),
    "1013": ("juan-02",),
    "1014": ("juan-03",),
    "1015": ("juan-04",),
    "1016": ("juan-05",),
    "1017": ("juan-06",),
    "1018": ("juan-07-puxian", "juan-07-shijie"),
    "1019": ("juan-08",),
    "1020": ("juan-09",),
    "1021": ("juan-10",),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def source_pages() -> dict[str, dict]:
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    pages = {}
    for section in index["sections"]:
        if section["id"] not in {item for values in TRACK_SECTIONS.values() for item in values}:
            continue
        payload = json.loads((ROOT / section["content"]).read_text(encoding="utf-8"))
        for page in payload["pages"]:
            pages[page["pageKey"]] = {**page, "sectionId": section["id"]}
    return pages


def assert_body_unchanged() -> None:
    result = subprocess.run(
        ["git", "diff", "--exit-code", "HEAD", "--", *BODY_PATHSPEC],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    require(result.returncode == 0, "source index or scripture body JSON differs from HEAD")


def audit(payload: dict) -> dict:
    assert_body_unchanged()
    source = source_pages()
    pages = payload["pages"]
    tracks = {row["track"]: row for row in payload["tracks"]}
    require(set(tracks) == set(TRACK_SECTIONS), "alignment must contain all ten tracks")
    require(len(pages) == 614, "alignment must contain 614 page rows")
    require([row["printedPage"] for row in pages] == list(range(2, 616)), "printed pages must be ordered 2 through 615")
    require(len({row["pageKey"] for row in pages}) == 614, "page keys must be unique")
    require(set(source) == {row["pageKey"] for row in pages}, "alignment/source page keys differ")

    low_confidence = []
    unspoken = []
    previous_by_track = {}
    for row in pages:
        track = tracks[row["track"]]
        source_row = source[row["pageKey"]]
        require(row["sectionId"] == source_row["sectionId"], f"{row['pageKey']}: section mismatch")
        require(row["printedPage"] == source_row["printedPage"], f"{row['pageKey']}: printed page mismatch")
        require(row["pdfPage"] == source_row["pdfPage"], f"{row['pageKey']}: PDF page mismatch")
        require(row["sectionId"] in TRACK_SECTIONS[row["track"]], f"{row['pageKey']}: wrong track")
        require(0 <= row["estimatedStart"] <= row["estimatedEnd"] <= track["duration"], f"{row['pageKey']}: invalid estimate")
        require(0 <= row["start"] <= row["end"] <= track["duration"], f"{row['pageKey']}: invalid final time")
        previous_end = previous_by_track.get(row["track"])
        if previous_end is not None:
            require(row["start"] + 0.002 >= previous_end, f"{row['pageKey']}: non-monotonic boundary")
        previous_by_track[row["track"]] = row["end"]
        if row["effectiveChars"]:
            require(row["spoken"] is True and row["end"] > row["start"], f"{row['pageKey']}: spoken page has no interval")
            require(row["matchedChars"] <= row["effectiveChars"], f"{row['pageKey']}: matched count exceeds source")
            require(row["matchCoverage"] is not None, f"{row['pageKey']}: missing coverage")
            if row["confidence"] == "low":
                low_confidence.append(row)
        else:
            require(row["spoken"] is False, f"{row['pageKey']}: empty facsimile marked spoken")
            require(row["start"] == row["end"], f"{row['pageKey']}: empty facsimile has duration")
            unspoken.append(row)

    for track_number, track in tracks.items():
        require(tuple(track["sectionIds"]) == TRACK_SECTIONS[track_number], f"track {track_number}: section list mismatch")
        require(track["contentStart"] < track["contentEnd"] <= track["duration"], f"track {track_number}: invalid content span")
        require(track["matchCoverage"] >= 0.5, f"track {track_number}: aggregate ASR coverage below 50%")
        require(track["exactMatchCoverage"] >= 0.35, f"track {track_number}: exact-character ASR coverage below 35%")
        require(track["sha256"] == track["sha256"].lower() and len(track["sha256"]) == 64, f"track {track_number}: invalid SHA-256")

    volume_seven = [row for row in pages if row["track"] == "1018" and row["spoken"]]
    split_before = [row for row in volume_seven if row["sectionId"] == "juan-07-puxian"][-1]
    split_after = [row for row in volume_seven if row["sectionId"] == "juan-07-shijie"][0]
    require(split_after["start"] + 0.002 >= split_before["end"], "volume seven split is not monotonic")

    coverages = [row["matchCoverage"] for row in pages if row["matchCoverage"] is not None]
    return {
        "pages": len(pages),
        "spokenPages": len(coverages),
        "unspokenPages": len(unspoken),
        "lowConfidencePages": len(low_confidence),
        "minimumPageCoverage": min(coverages),
        "medianPageCoverage": sorted(coverages)[len(coverages) // 2],
        "minimumTrackCoverage": min(track["matchCoverage"] for track in tracks.values()),
        "minimumExactTrackCoverage": min(track["exactMatchCoverage"] for track in tracks.values()),
        "volumeSevenSplit": [split_before["pageKey"], split_after["pageKey"]],
        "lowConfidencePageKeys": [row["pageKey"] for row in low_confidence],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--alignment", type=Path, default=ALIGNMENT_PATH)
    args = parser.parse_args()
    payload = json.loads(args.alignment.read_text(encoding="utf-8"))
    summary = audit(payload)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, FileNotFoundError, KeyError, ValueError) as error:
        print(f"audio alignment audit failed: {error}", file=sys.stderr)
        raise SystemExit(1)
