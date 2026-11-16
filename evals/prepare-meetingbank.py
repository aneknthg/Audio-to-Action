#!/usr/bin/env python3
"""Download a deterministic sample of MeetingBank test rows as local JSON cases.

Install with: python3 -m pip install datasets
Run with: python3 evals/prepare-meetingbank.py --limit 25
"""
import argparse
import json
from pathlib import Path

from datasets import load_dataset

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "datasets" / "meetingbank"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", default="test", help="Dataset split (default: test)")
    parser.add_argument("--limit", type=int, default=25, help="Number of cases to save")
    parser.add_argument(
        "--max-chars",
        type=int,
        default=18000,
        help="Skip transcripts longer than this to keep model requests manageable",
    )
    args = parser.parse_args()

    dataset = load_dataset("huuuyeah/meetingbank", split=args.split)
    OUT.mkdir(parents=True, exist_ok=True)

    saved = 0
    skipped = 0
    for row in dataset:
        transcript = str(row.get("transcript") or "").strip()
        summary = str(row.get("summary") or "").strip()
        if not transcript or not summary:
            skipped += 1
            continue
        if args.max_chars and len(transcript) > args.max_chars:
            skipped += 1
            continue

        case_id = f"meetingbank-{row.get('id', saved)}"
        case = {
            "id": case_id,
            "source": "huuuyeah/meetingbank",
            "split": args.split,
            "transcript": transcript,
            "expected": {"summary": summary},
        }
        (OUT / f"{case_id}.json").write_text(
            json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        saved += 1
        if saved >= args.limit:
            break

    if not saved:
        raise SystemExit("No usable examples found. Try increasing --max-chars.")

    print(f"Saved {saved} cases to {OUT}")
    print(f"Skipped {skipped} rows without text or over the transcript length limit")


if __name__ == "__main__":
    main()
