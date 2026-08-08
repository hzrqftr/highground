#!/usr/bin/env python3
"""Sync local hero metadata from a public Dota hero source.

Usage:
  python sync_heroes.py --dry-run
  python sync_heroes.py
  python sync_heroes.py --source https://api.opendota.com/api/heroes
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib import request, error

DEFAULT_SOURCE = "https://api.opendota.com/api/heroes"
FALLBACK_SOURCE = "https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json"
DEFAULT_OUTPUT = Path("data/heroes.json")

# OpenDota's /api/heroes carries no icon/img URLs at all. dotaconstants does, as
# CDN-relative paths — and it's the only reliable source for them: Valve dropped
# the npc_dota_hero_ filename prefix at some point (e.g. antimage, but
# crystal_maiden keeps its underscore), so the current filenames aren't
# derivable from the hero's internal name by string manipulation.
ICON_SOURCE = FALLBACK_SOURCE
CDN_BASE = "https://cdn.cloudflare.steamstatic.com"


def fetch_json(url: str) -> Any:
    req = request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.URLError as exc:
        raise RuntimeError(f"Unable to fetch hero data from {url}: {exc}") from exc


def fetch_hero_data(primary_url: str) -> tuple[Any, str]:
    candidates = [primary_url, FALLBACK_SOURCE]
    last_error: Exception | None = None

    for url in candidates:
        try:
            return fetch_json(url), url
        except RuntimeError as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"Unable to fetch hero data from any configured source: {candidates}")


def fetch_icon_map(url: str) -> dict[int, dict[str, str]]:
    """dotaconstants' heroes.json is a dict keyed by hero id (unlike OpenDota's
    array), each with relative icon/img paths. Rehost on Valve's CDN and drop
    the trailing '?' Valve uses for cache-busting — the file resolves fine
    without it."""
    try:
        data = fetch_json(url)
    except RuntimeError as exc:
        print(f"Warning: couldn't fetch icon/img URLs from {url}: {exc}")
        return {}

    if not isinstance(data, dict):
        print(f"Warning: expected an object keyed by hero id at {url}, got {type(data).__name__}")
        return {}

    icon_map: dict[int, dict[str, str]] = {}
    for hero in data.values():
        if not isinstance(hero, dict) or not isinstance(hero.get("id"), int):
            continue
        icon_path = hero.get("icon")
        img_path = hero.get("img")
        icon_map[hero["id"]] = {
            "icon": CDN_BASE + icon_path.split("?")[0] if icon_path else "",
            "img": CDN_BASE + img_path.split("?")[0] if img_path else "",
        }
    return icon_map


def load_local(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    # utf-8-sig: the existing file was saved with a UTF-8 BOM (Windows-tool
    # convention) — plain "utf-8" chokes on it, utf-8-sig strips it if present
    # and is a no-op otherwise.
    with path.open("r", encoding="utf-8-sig") as fh:
        data = json.load(fh)

    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array in {path}")
    return data


def normalize_hero(hero: dict[str, Any], icon_map: dict[int, dict[str, str]]) -> dict[str, Any]:
    hero_id = int(hero.get("id", 0))
    normalized = {
        "id": hero_id,
        "name": str(hero.get("name", "")),
        "localized_name": str(hero.get("localized_name", "")),
        "primary_attr": str(hero.get("primary_attr", "")),
        "attack_type": str(hero.get("attack_type", "")),
        "roles": list(hero.get("roles", [])) if isinstance(hero.get("roles", []), list) else [],
    }
    icons = icon_map.get(hero_id)
    if icons:
        normalized["icon"] = icons["icon"]
        normalized["img"] = icons["img"]
    return normalized


def merge_heroes(
    remote_heroes: list[dict[str, Any]],
    local_heroes: list[dict[str, Any]],
    icon_map: dict[int, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    local_by_id = {int(hero.get("id", -1)): hero for hero in local_heroes if isinstance(hero.get("id"), int)}
    merged: list[dict[str, Any]] = []
    changes: list[str] = []

    for hero in remote_heroes:
        normalized = normalize_hero(hero, icon_map)
        hero_id = normalized["id"]
        local_hero = local_by_id.get(hero_id)

        if local_hero is None:
            merged.append(normalized)
            changes.append(f"Added hero {normalized['localized_name']} ({hero_id})")
            continue

        merged.append({**local_hero, **normalized})

        if local_hero != {**local_hero, **normalized}:
            changes.append(f"Updated hero {normalized['localized_name']} ({hero_id})")

    if not remote_heroes:
        raise ValueError("No heroes found in remote source")

    merged.sort(key=lambda hero: hero.get("id", 0))
    return merged, changes


def write_json(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync hero metadata from OpenDota or a similar public API.")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="URL for the hero metadata JSON source.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to the local JSON file to update.")
    parser.add_argument("--dry-run", action="store_true", help="Only print the summary without writing files.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output)

    remote_data, active_source = fetch_hero_data(args.source)
    if not isinstance(remote_data, list):
        raise ValueError(f"Expected the source at {active_source} to be a JSON array")

    icon_map = fetch_icon_map(ICON_SOURCE)

    local_data = load_local(output_path)
    merged, changes = merge_heroes(remote_data, local_data, icon_map)

    if args.dry_run:
        print(f"Source: {active_source}")
        print(f"Local file: {output_path}")
        print(f"Heroes found: {len(remote_data)}")
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
    print(f"Updated {output_path} with {len(merged)} heroes from {active_source}")
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
