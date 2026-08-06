#!/usr/bin/env python3
"""Sync local item metadata from a public Dota item source.

Usage:
  python sync_items.py --dry-run
  python sync_items.py
  python sync_items.py --source https://api.opendota.com/api/constants/items
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib import request, error

DEFAULT_SOURCE = "https://api.opendota.com/api/constants/items"
FALLBACK_SOURCE = "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json"
DEFAULT_OUTPUT = Path("data/items.json")


def fetch_json(url: str) -> Any:
    req = request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.URLError as exc:
        raise RuntimeError(f"Unable to fetch item data from {url}: {exc}") from exc


def fetch_item_data(primary_url: str) -> tuple[Any, str]:
    candidates = [primary_url, FALLBACK_SOURCE]
    last_error: Exception | None = None

    for url in candidates:
        try:
            return fetch_json(url), url
        except RuntimeError as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Unable to fetch item data from any configured source: {candidates}")


def load_local(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array in {path}")
    return data


def normalize_item(key: str, item: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "id": int(item.get("id", 0)),
        "name": str(key),
        "localized_name": str(item.get("dname", key)),
        "cost": int(item.get("cost", 0)) if item.get("cost") is not None else 0,
        "quality": str(item.get("qual", "")),
        "img": str(item.get("img", "")),
    }
    return normalized


def merge_items(remote_items: dict[str, Any], local_items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    local_by_id = {int(item.get("id", -1)): item for item in local_items if isinstance(item.get("id"), int)}
    merged: list[dict[str, Any]] = []
    changes: list[str] = []

    for key, item in remote_items.items():
        if not isinstance(item, dict) or "id" not in item:
            continue

        normalized = normalize_item(key, item)
        item_id = normalized["id"]
        local_item = local_by_id.get(item_id)

        if local_item is None:
            merged.append(normalized)
            changes.append(f"Added item {normalized['localized_name']} ({item_id})")
            continue

        merged.append({**local_item, **normalized})

        if local_item != {**local_item, **normalized}:
            changes.append(f"Updated item {normalized['localized_name']} ({item_id})")

    if not remote_items:
        raise ValueError("No items found in remote source")

    merged.sort(key=lambda item: item.get("id", 0))
    return merged, changes


def write_json(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync item metadata from OpenDota or a similar public API.")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="URL for the item metadata JSON source.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to the local JSON file to update.")
    parser.add_argument("--dry-run", action="store_true", help="Only print the summary without writing files.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output)

    remote_data, active_source = fetch_item_data(args.source)
    if not isinstance(remote_data, dict):
        raise ValueError(f"Expected the source at {active_source} to be a JSON object keyed by item name")

    local_data = load_local(output_path)
    merged, changes = merge_items(remote_data, local_data)

    if args.dry_run:
        print(f"Source: {active_source}")
        print(f"Local file: {output_path}")
        print(f"Items found: {len(remote_data)}")
        print(f"Changes: {len(changes)}")
        if changes:
            for change in changes[:10]:
                print(f"- {change}")
            if len(changes) > 10:
                print(f"- ... and {len(changes) - 10} more")
        else:
            print("No changes detected.")
        return 0

    write_json(output_path, merged)
    print(f"Updated {output_path} with {len(merged)} items from {active_source}")
    print(f"Applied {len(changes)} changes.")
    if changes:
        for change in changes[:10]:
            print(f"- {change}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"Error: {exc}", flush=True)
        raise SystemExit(1)
