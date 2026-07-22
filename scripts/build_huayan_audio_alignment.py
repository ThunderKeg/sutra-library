#!/usr/bin/env python3
"""Build page-level audio alignment for Huayan volume one.

The source scripture JSON is read-only. Intermediate estimates and ASR output
stay under the ignored sources/audio directory; only the reviewed alignment
metadata is intended for publication.
"""

from __future__ import annotations

import argparse
from bisect import bisect_left
import ctypes
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import sys
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data/huayan/volume-01-index.json"
SOURCE_DIR = ROOT / "sources/audio/huayan-01"
ESTIMATE_PATH = SOURCE_DIR / "alignment-estimate.json"
ASR_DIR = SOURCE_DIR / "asr"
OUTPUT_PATH = ROOT / "data/huayan/volume-01-audio-alignment.json"
PROGRESS_PATH = ROOT / "docs/huayan-audio-alignment-progress.md"
BODY_MANIFEST_SHA1 = "8e566e27ce88008eb7a27a5d27b615c69377ea23"
AUDIO_BASE_URL = "https://wz.yyxcfg.com/a/a/4"
AUDIO_SOURCE_PAGE = "https://www.fodizi.net/fojing/23/7444.html"

TRACK_SECTIONS = {
    1012: ("juan-01",),
    1013: ("juan-02",),
    1014: ("juan-03",),
    1015: ("juan-04",),
    1016: ("juan-05",),
    1017: ("juan-06",),
    1018: ("juan-07-puxian", "juan-07-shijie"),
    1019: ("juan-08",),
    1020: ("juan-09",),
    1021: ("juan-10",),
}
KNOWN_CONTENT_START_PHRASES = {1012: "如是我聞"}
TRACKS_WITH_PRINTED_OPENING_CHANT = set(range(1013, 1022))

CJK_RE = re.compile(r"[\u3400-\u9fff]")


@dataclass(frozen=True)
class Page:
    section_id: str
    page_key: str
    printed_page: int
    pdf_page: int
    text: str

    @property
    def normalized(self) -> str:
        return normalize_text(self.text)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audio_duration(path: Path) -> float:
    try:
        import av
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise SystemExit("PyAV is required; install requirements-audio.txt") from error
    with av.open(str(path)) as container:
        if container.duration is not None:
            return float(container.duration / av.time_base)
        stream = container.streams.audio[0]
        return float(stream.duration * stream.time_base)


def converter():
    try:
        from opencc import OpenCC
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise SystemExit("OpenCC is required; install requirements-audio.txt") from error
    return OpenCC("t2s")


_OPENCC = None
_DLL_HANDLES = []


def normalize_text(text: str) -> str:
    global _OPENCC
    if _OPENCC is None:
        _OPENCC = converter()
    simplified = _OPENCC.convert(text)
    return "".join(CJK_RE.findall(simplified))


def load_pages() -> tuple[dict, dict[str, Page], dict[int, list[Page]]]:
    index = load_json(INDEX_PATH)
    pages_by_key: dict[str, Page] = {}
    pages_by_track: dict[int, list[Page]] = {}
    section_meta = {section["id"]: section for section in index["sections"]}
    for track, section_ids in TRACK_SECTIONS.items():
        track_pages: list[Page] = []
        for section_id in section_ids:
            section = section_meta[section_id]
            payload = load_json(ROOT / section["content"])
            for raw in payload["pages"]:
                page = Page(
                    section_id=section_id,
                    page_key=raw["pageKey"],
                    printed_page=int(raw["printedPage"]),
                    pdf_page=int(raw["pdfPage"]),
                    text=raw.get("text", ""),
                )
                pages_by_key[page.page_key] = page
                track_pages.append(page)
        pages_by_track[track] = track_pages
    if sorted(page.printed_page for page in pages_by_key.values()) != list(range(2, 616)):
        raise RuntimeError("expected each printed page from 2 through 615 exactly once")
    return index, pages_by_key, pages_by_track


def track_metadata(track: int, path: Path) -> dict:
    return {
        "track": str(track),
        "url": f"{AUDIO_BASE_URL}/{track}.m4a",
        "fileSize": path.stat().st_size,
        "sha256": sha256_file(path),
        "duration": round(audio_duration(path), 3),
        "sectionIds": list(TRACK_SECTIONS[track]),
    }


def build_estimate(output: Path) -> dict:
    _index, _pages_by_key, pages_by_track = load_pages()
    tracks = []
    all_pages = []
    for track, pages in pages_by_track.items():
        audio_path = SOURCE_DIR / f"{track}.m4a"
        if not audio_path.exists():
            raise FileNotFoundError(audio_path)
        meta = track_metadata(track, audio_path)
        char_counts = [len(page.normalized) for page in pages]
        total_chars = sum(char_counts)
        if not total_chars:
            raise RuntimeError(f"track {track} has no source characters")
        duration = meta["duration"]
        cursor = 0
        page_rows = []
        for page, count in zip(pages, char_counts):
            start = duration * cursor / total_chars
            cursor += count
            end = duration * cursor / total_chars
            row = {
                "sectionId": page.section_id,
                "pageKey": page.page_key,
                "printedPage": page.printed_page,
                "pdfPage": page.pdf_page,
                "track": str(track),
                "effectiveChars": count,
                "estimatedStart": round(start, 3),
                "estimatedEnd": round(end, 3),
                "spoken": count > 0,
            }
            page_rows.append(row)
            all_pages.append(row)
        meta.update(
            {
                "effectiveChars": total_chars,
                "estimatedSecondsPerChar": round(duration / total_chars, 6),
                "pages": page_rows,
            }
        )
        tracks.append(meta)
        print(f"estimate {track}: {len(pages)} pages, {total_chars} chars, {duration:.3f}s")
    payload = {
        "version": 1,
        "generatedAt": utc_now(),
        "method": "effective CJK character count distributed at the measured average track speed",
        "bodyManifestSha1": BODY_MANIFEST_SHA1,
        "audioSourcePage": AUDIO_SOURCE_PAGE,
        "tracks": tracks,
        "pages": sorted(all_pages, key=lambda row: row["printedPage"]),
    }
    write_json(output, payload)
    return payload


def parse_tracks(value: str | None) -> list[int]:
    if not value:
        return list(TRACK_SECTIONS)
    tracks = [int(item.strip()) for item in value.split(",") if item.strip()]
    unknown = sorted(set(tracks) - set(TRACK_SECTIONS))
    if unknown:
        raise SystemExit(f"unknown tracks: {unknown}")
    return tracks


def add_windows_dll_directory(path: str | None) -> None:
    if not path:
        return
    dll_path = Path(path).resolve()
    if not dll_path.exists():
        raise FileNotFoundError(dll_path)
    os.environ["PATH"] = str(dll_path) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        _DLL_HANDLES.append(os.add_dll_directory(str(dll_path)))
    # CTranslate2 resolves these by filename at inference time. Preloading the
    # libraries also makes the self-contained Windows bundle visible there.
    if sys.platform == "win32":
        for filename in ("cublasLt64_12.dll", "cublas64_12.dll", "cudnn64_9.dll"):
            ctypes.WinDLL(str(dll_path / filename))


def transcribe_tracks(
    tracks: Iterable[int],
    model_name: str,
    device: str,
    compute_type: str,
    model_dir: Path | None,
    dll_dir: str | None,
    local_files_only: bool,
) -> None:
    add_windows_dll_directory(dll_dir)
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise SystemExit("faster-whisper is required; install requirements-audio.txt") from error

    kwargs = {"device": device, "compute_type": compute_type, "local_files_only": local_files_only}
    if model_dir:
        kwargs["download_root"] = str(model_dir)
    print(f"loading faster-whisper {model_name} on {device}/{compute_type}", flush=True)
    model = WhisperModel(model_name, **kwargs)
    model_label = "small" if "faster-whisper-small" in model_name else Path(model_name).name
    ASR_DIR.mkdir(parents=True, exist_ok=True)
    for track in tracks:
        output = ASR_DIR / f"{track}.json"
        if output.exists():
            print(f"asr {track}: existing output retained", flush=True)
            continue
        audio_path = SOURCE_DIR / f"{track}.m4a"
        print(f"asr {track}: starting", flush=True)
        segments_iter, info = model.transcribe(
            str(audio_path),
            language="zh",
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=True,
            initial_prompt="大方廣佛華嚴經，唐于闐國三藏沙門實叉難陀譯。",
        )
        segments = []
        for number, segment in enumerate(segments_iter, 1):
            words = [
                {
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                    "word": word.word,
                    "probability": round(float(word.probability), 6),
                }
                for word in (segment.words or [])
            ]
            segments.append(
                {
                    "id": segment.id,
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": segment.text,
                    "avgLogprob": round(float(segment.avg_logprob), 6),
                    "noSpeechProb": round(float(segment.no_speech_prob), 6),
                    "words": words,
                }
            )
            if number % 100 == 0:
                print(f"asr {track}: {number} segments, through {segment.end:.1f}s", flush=True)
        payload = {
            "version": 1,
            "generatedAt": utc_now(),
            "track": str(track),
            "audioSha256": sha256_file(audio_path),
            "model": model_label,
            "device": device,
            "computeType": compute_type,
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 6),
            "duration": round(float(info.duration), 3),
            "durationAfterVad": round(float(info.duration_after_vad), 3),
            "segments": segments,
        }
        write_json(output, payload)
        print(f"asr {track}: wrote {len(segments)} segments", flush=True)


def asr_timed_characters(payload: dict) -> tuple[str, list[float], list[float]]:
    characters: list[str] = []
    starts: list[float] = []
    ends: list[float] = []
    for segment in payload["segments"]:
        words = segment.get("words") or []
        if not words:
            words = [{"word": segment["text"], "start": segment["start"], "end": segment["end"]}]
        for word in words:
            normalized = normalize_text(word.get("word", ""))
            if not normalized:
                continue
            start = float(word["start"])
            end = max(start, float(word["end"]))
            span = end - start
            for index, character in enumerate(normalized):
                characters.append(character)
                starts.append(start + span * index / len(normalized))
                ends.append(start + span * (index + 1) / len(normalized))
    return "".join(characters), starts, ends


def source_stream(pages: list[Page]) -> tuple[str, list[tuple[int, int]]]:
    text_parts = []
    bounds = []
    cursor = 0
    for page in pages:
        text = page.normalized
        start = cursor
        cursor += len(text)
        bounds.append((start, cursor))
        text_parts.append(text)
    return "".join(text_parts), bounds


def alignment_anchors(source: str, asr: str, asr_starts: list[float], asr_ends: list[float]):
    try:
        from rapidfuzz.distance import Levenshtein
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise SystemExit("rapidfuzz is required; install requirements-audio.txt") from error

    def equal_pairs(left, right):
        return [
            (left_start + offset, right_start + offset)
            for operation, left_start, left_end, right_start, _right_end in Levenshtein.opcodes(left, right)
            if operation == "equal"
            for offset in range(left_end - left_start)
        ]

    exact_pairs = equal_pairs(source, asr)

    # ASR often substitutes a homophone in Buddhist names. A second global
    # edit alignment on pinyin supplies monotonic fallback anchors while the
    # exact-character matches remain separately measurable.
    try:
        from pypinyin import lazy_pinyin
    except ImportError as error:  # pragma: no cover - dependency guidance
        raise SystemExit("pypinyin is required; install requirements-audio.txt") from error
    source_pinyin = lazy_pinyin(source, errors=lambda value: list(value))
    asr_pinyin = lazy_pinyin(asr, errors=lambda value: list(value))
    phonetic_pairs = equal_pairs(source_pinyin, asr_pinyin)

    exact_by_source = dict(exact_pairs)
    combined = dict(phonetic_pairs)
    combined.update(exact_by_source)

    anchors = [
        (source_index, (asr_starts[asr_index] + asr_ends[asr_index]) / 2)
        for source_index, asr_index in sorted(combined.items())
    ]
    exact_source = set(exact_by_source)
    matched_source = set(combined)
    anchors.sort()
    return anchors, matched_source, exact_source


def robust_seconds_per_char(anchors: list[tuple[int, float]], fallback: float) -> float:
    slopes = []
    for (source_a, time_a), (source_b, time_b) in zip(anchors, anchors[1:]):
        delta_chars = source_b - source_a
        delta_time = time_b - time_a
        if 2 <= delta_chars <= 80 and 0 < delta_time < 60:
            slopes.append(delta_time / delta_chars)
    if not slopes:
        return fallback
    median = statistics.median(slopes)
    return min(max(median, 0.12), 1.2)


def boundary_time(
    boundary: int,
    anchors: list[tuple[int, float]],
    source_length: int,
    duration: float,
    seconds_per_char: float,
) -> float:
    positions = [item[0] for item in anchors]
    index = bisect_left(positions, boundary)
    if 0 < index < len(anchors):
        left_pos, left_time = anchors[index - 1]
        right_pos, right_time = anchors[index]
        if right_pos == left_pos:
            return left_time
        ratio = (boundary - left_pos) / (right_pos - left_pos)
        return left_time + (right_time - left_time) * ratio
    if index == 0:
        pos, timestamp = anchors[0]
        return max(0.0, timestamp - (pos - boundary) * seconds_per_char)
    pos, timestamp = anchors[-1]
    return min(duration, timestamp + (boundary - pos) * seconds_per_char)


def build_precise_alignment(estimate_path: Path, output_path: Path) -> dict:
    estimate = load_json(estimate_path)
    _index, _pages_by_key, pages_by_track = load_pages()
    estimate_pages = {row["pageKey"]: row for row in estimate["pages"]}
    track_estimates = {int(row["track"]): row for row in estimate["tracks"]}
    output_tracks = []
    output_pages = []

    for track, pages in pages_by_track.items():
        asr_path = ASR_DIR / f"{track}.json"
        if not asr_path.exists():
            raise FileNotFoundError(asr_path)
        asr_payload = load_json(asr_path)
        asr_text, asr_starts, asr_ends = asr_timed_characters(asr_payload)
        source_text, page_bounds = source_stream(pages)
        anchors, matched_source, exact_source = alignment_anchors(source_text, asr_text, asr_starts, asr_ends)
        start_phrase = normalize_text(KNOWN_CONTENT_START_PHRASES.get(track, ""))
        if start_phrase:
            asr_phrase_index = asr_text.find(start_phrase)
            if asr_phrase_index < 0:
                raise RuntimeError(f"track {track}: known content-start phrase was not recognized")
            phrase_start_time = asr_starts[asr_phrase_index]
            anchors = [(position, timestamp) for position, timestamp in anchors if timestamp >= phrase_start_time]
            anchors.extend(
                (offset, (asr_starts[asr_phrase_index + offset] + asr_ends[asr_phrase_index + offset]) / 2)
                for offset in range(len(start_phrase))
            )
            anchors = sorted(dict(anchors).items())
        if len(anchors) < max(100, len(source_text) // 10):
            raise RuntimeError(f"track {track}: insufficient anchors ({len(anchors)}/{len(source_text)})")
        duration = float(track_estimates[track]["duration"])
        fallback = duration / max(1, len(source_text))
        seconds_per_char = robust_seconds_per_char(anchors, fallback)
        content_start = 0.0 if track in TRACKS_WITH_PRINTED_OPENING_CHANT else boundary_time(
            0, anchors, len(source_text), duration, seconds_per_char
        )
        content_end = boundary_time(len(source_text), anchors, len(source_text), duration, seconds_per_char)
        previous_end = max(0.0, min(duration, content_start))
        page_rows = []
        for page, (source_start, source_end) in zip(pages, page_bounds):
            estimate_row = estimate_pages[page.page_key]
            effective_chars = source_end - source_start
            if effective_chars:
                start = previous_end if source_start == 0 else max(
                    previous_end,
                    boundary_time(source_start, anchors, len(source_text), duration, seconds_per_char),
                )
                end = max(start, boundary_time(source_end, anchors, len(source_text), duration, seconds_per_char))
                end = min(duration, end)
                matched = sum(1 for char_index in range(source_start, source_end) if char_index in matched_source)
                exact_matched = sum(1 for char_index in range(source_start, source_end) if char_index in exact_source)
                coverage = matched / effective_chars
                exact_coverage = exact_matched / effective_chars
            else:
                start = previous_end
                end = previous_end
                matched = 0
                exact_matched = 0
                coverage = None
                exact_coverage = None
            row = {
                **{key: estimate_row[key] for key in (
                    "sectionId", "pageKey", "printedPage", "pdfPage", "track",
                    "effectiveChars", "estimatedStart", "estimatedEnd", "spoken"
                )},
                "start": round(start, 3),
                "end": round(end, 3),
                "matchedChars": matched,
                "exactMatchedChars": exact_matched,
                "matchCoverage": None if coverage is None else round(coverage, 4),
                "exactMatchCoverage": None if exact_coverage is None else round(exact_coverage, 4),
                "confidence": "unspoken" if coverage is None else ("high" if coverage >= 0.75 else "medium" if coverage >= 0.5 else "low"),
            }
            page_rows.append(row)
            output_pages.append(row)
            previous_end = end
        coverage = len(matched_source) / len(source_text)
        track_row = {
            **{key: track_estimates[track][key] for key in (
                "track", "url", "fileSize", "sha256", "duration", "sectionIds", "effectiveChars"
            )},
            "asrModel": asr_payload["model"],
            "asrLanguageProbability": asr_payload["languageProbability"],
            "recognizedChars": len(asr_text),
            "matchedChars": len(matched_source),
            "exactMatchedChars": len(exact_source),
            "matchCoverage": round(coverage, 4),
            "exactMatchCoverage": round(len(exact_source) / len(source_text), 4),
            "contentStart": round(content_start, 3),
            "contentEnd": round(content_end, 3),
            "secondsPerChar": round(seconds_per_char, 6),
            "pages": page_rows,
        }
        output_tracks.append(track_row)
        print(
            f"align {track}: coverage {coverage:.1%}, content {content_start:.1f}-{content_end:.1f}s, "
            f"{seconds_per_char:.3f}s/char"
        )

    payload = {
        "version": 1,
        "generatedAt": utc_now(),
        "bookId": "huayan",
        "volume": "01",
        "bodyManifestSha1": BODY_MANIFEST_SHA1,
        "method": "faster-whisper word timestamps globally edit-aligned to normalized source characters with phonetic fallback",
        "audioSourcePage": AUDIO_SOURCE_PAGE,
        "audioReader": "慧平法師",
        "tracks": output_tracks,
        "pages": sorted(output_pages, key=lambda row: row["printedPage"]),
    }
    write_json(output_path, payload)
    return payload


def update_progress(stage: str) -> None:
    if stage not in {"estimate", "asr", "review", "complete"}:
        raise ValueError(stage)
    content = PROGRESS_PATH.read_text(encoding="utf-8")
    lines = []
    for line in content.splitlines():
        columns = line.split("|")
        if len(columns) != 9 or not columns[2].strip().isdigit():
            lines.append(line)
            continue
        # columns: empty, complete, page, pdf, section, estimate, ASR, review, empty
        if stage in {"estimate", "asr", "review", "complete"}:
            columns[5] = " [x] "
        if stage in {"asr", "review", "complete"}:
            columns[6] = " [x] "
        if stage in {"review", "complete"}:
            columns[7] = " [x] "
        if stage == "complete":
            columns[1] = " [x] "
        lines.append("|".join(columns))
    PROGRESS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    estimate_parser = subparsers.add_parser("estimate", help="build measured-duration character-count estimates")
    estimate_parser.add_argument("--output", type=Path, default=ESTIMATE_PATH)

    transcribe_parser = subparsers.add_parser("transcribe", help="run faster-whisper and retain raw timestamps")
    transcribe_parser.add_argument("--tracks", help="comma-separated audio numbers; default all")
    transcribe_parser.add_argument("--model", default="large-v3-turbo")
    transcribe_parser.add_argument("--device", default="cuda")
    transcribe_parser.add_argument("--compute-type", default="float16")
    transcribe_parser.add_argument("--model-dir", type=Path, default=SOURCE_DIR / "models")
    transcribe_parser.add_argument("--dll-dir", help="Windows directory containing CUDA/cuDNN runtime DLLs")
    transcribe_parser.add_argument("--local-files-only", action="store_true")

    align_parser = subparsers.add_parser("align", help="align ASR characters to the source and publish page metadata")
    align_parser.add_argument("--estimate", type=Path, default=ESTIMATE_PATH)
    align_parser.add_argument("--output", type=Path, default=OUTPUT_PATH)

    progress_parser = subparsers.add_parser("progress", help="mechanically check completed per-page stages")
    progress_parser.add_argument("stage", choices=("estimate", "asr", "review", "complete"))

    args = parser.parse_args()
    if args.command == "estimate":
        build_estimate(args.output)
    elif args.command == "transcribe":
        transcribe_tracks(
            parse_tracks(args.tracks), args.model, args.device, args.compute_type, args.model_dir, args.dll_dir,
            args.local_files_only
        )
    elif args.command == "align":
        build_precise_alignment(args.estimate, args.output)
    elif args.command == "progress":
        update_progress(args.stage)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
