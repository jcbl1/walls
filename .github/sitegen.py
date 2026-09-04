#!/usr/bin/env python

from configparser import ConfigParser
from datetime import datetime, timezone
from json import dumps, loads
from os import environ, listdir
from os.path import getsize, isfile
from pathlib import Path
from sys import argv, exit, stderr
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

MANIFEST_VERSION = 1


def get_config(config_path: Path = Path("./.github/config.ini")) -> dict[str, str]:
    parser = ConfigParser()
    parser.read_string(config_path.read_text())
    config = dict(parser.defaults())
    if parser.has_section("site"):
        config.update(dict(parser.items("site")))
    return config


def excluded(config: dict[str, str]) -> set[str]:
    return {name for name in (config.get("exclude") or "").split(":") if name}


def file_kind(ext: str, config: dict[str, str]) -> str | None:
    if ext in (config.get("video_ext") or "").split(":"):
        return "video"
    if ext in (config.get("image_ext") or "").split(":"):
        return "image"
    return None


def entry(path: str, size: int, config: dict[str, str]) -> dict | None:
    name = path.rsplit("/", 1)[-1]
    if name == "README.md" or name.startswith("."):
        return None
    stem, dot, ext = name.rpartition(".")
    kind = file_kind(ext.casefold(), config) if dot else None
    if kind is None:
        return None
    return {
        "path": path,
        "stem": stem,
        "ext": ext.casefold(),
        "kind": kind,
        "bytes": size,
        "views": None,
    }


def scan_local(config: dict[str, str]) -> dict[str, list[dict]]:
    skip = excluded(config)
    categories: dict[str, list[dict]] = {}
    for category in sorted(listdir(".")):
        if category.startswith(".") or isfile(category) or category in skip:
            continue
        for name in sorted(listdir(category)):
            path = f"{category}/{name}"
            if not isfile(path):
                continue
            item = entry(path, getsize(path), config)
            if item:
                categories.setdefault(category, []).append(item)
    return categories


def fetch_tree(owner_repo: str, branch: str, token: str | None) -> dict:
    url = f"https://api.github.com/repos/{owner_repo}/git/trees/{quote(branch, safe='/')}?recursive=1"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "walls-sitegen"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urlopen(Request(url, headers=headers), timeout=60) as response:
        return loads(response.read())


def scan_tree(config: dict[str, str]) -> dict[str, list[dict]]:
    owner_repo = environ.get("GITHUB_REPOSITORY")
    if not owner_repo:
        exit("sitegen: GITHUB_REPOSITORY is required in --ci mode")
    branch = environ.get("GITHUB_REF_NAME") or config.get("branch", "main")
    tree = fetch_tree(owner_repo, branch, environ.get("GITHUB_TOKEN"))
    if tree.get("truncated"):
        print("warning: git tree listing was truncated; manifest may be incomplete", file=stderr)
    skip = excluded(config)
    categories: dict[str, list[dict]] = {}
    for node in tree["tree"]:
        if node["type"] != "blob":
            continue
        parts = node["path"].split("/", 1)
        if len(parts) != 2 or parts[0].startswith(".") or parts[0] in skip:
            continue
        item = entry(node["path"], node.get("size", 0), config)
        if item:
            categories.setdefault(parts[0], []).append(item)
    return categories


def build_manifest(config: dict[str, str], categories: dict[str, list[dict]], base_url: str) -> dict:
    return {
        "version": MANIFEST_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "base_url": base_url,
        "categories": [
            {
                "name": name,
                "count": len(files),
                "files": sorted(files, key=lambda file: file["path"]),
            }
            for name, files in sorted(categories.items())
        ],
    }


def main() -> None:
    mode, dry = "local", False
    for arg in argv[1:]:
        if arg == "--ci":
            mode = "ci"
        elif arg == "--local":
            mode = "local"
        elif arg == "--dry":
            dry = True
        else:
            exit(f"sitegen: unknown argument {arg!r}")
    config = get_config()
    try:
        categories = scan_tree(config) if mode == "ci" else scan_local(config)
    except HTTPError as error:
        exit(f"sitegen: GitHub API failed with HTTP {error.code}")
    if mode == "ci":
        owner_repo = environ["GITHUB_REPOSITORY"]
        branch = environ.get("GITHUB_REF_NAME") or config.get("branch", "main")
        base_url = f"https://raw.githubusercontent.com/{owner_repo}/{branch}"
    else:
        base_url = ".."
    manifest = build_manifest(config, categories, base_url)
    if dry:
        print(dumps(manifest, indent=2))
        return
    target = Path(config.get("manifest", "site/manifest.json"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(dumps(manifest, indent=2) + "\n")
    stats = target.parent / "stats.json"
    if not stats.exists():
        stats.write_text(dumps({}) + "\n")
    total = sum(category["count"] for category in manifest["categories"])
    print(f"sitegen: wrote {target} ({len(manifest['categories'])} categories, {total} files, mode={mode})")


if __name__ == "__main__":
    main()
