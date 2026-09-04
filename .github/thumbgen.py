#!/usr/bin/env python

from argparse import ArgumentParser
from concurrent.futures import ProcessPoolExecutor
from configparser import ConfigParser
from importlib.util import find_spec
from json import loads
from os import cpu_count
from pathlib import Path
from shutil import which
from subprocess import DEVNULL, run
from sys import exit, stderr


def get_config(config_path: Path = Path("./.github/config.ini")) -> dict[str, str]:
    parser = ConfigParser()
    parser.read_string(config_path.read_text())
    config = dict(parser.defaults())
    if parser.has_section("site"):
        config.update(dict(parser.items("site")))
    return config


def pending_jobs(manifest: dict, out_dir: Path) -> list[dict]:
    jobs = []
    for category in manifest.get("categories", []):
        for file in category.get("files", []):
            source = Path(file["path"])
            target = out_dir / category["name"] / f"{source.name}.webp"
            if target.exists():
                continue
            jobs.append({"kind": file["kind"], "source": source, "target": target})
    return jobs


def convert_image(job: dict, width: int, quality: int) -> None:
    from PIL import Image, ImageOps

    with Image.open(job["source"]) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((width, width * 10))
        if image.mode not in ("RGB", "RGBA"):
            has_alpha = "A" in image.getbands() or "transparency" in image.info
            image = image.convert("RGBA" if has_alpha else "RGB")
        job["target"].parent.mkdir(parents=True, exist_ok=True)
        image.save(job["target"], "WEBP", quality=quality, method=4)


def convert_video(job: dict, width: int) -> None:
    job["target"].parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", "0", "-i", str(job["source"]),
            "-frames:v", "1", "-vf", f"scale={width}:-2",
            str(job["target"]),
        ],
        stdin=DEVNULL, stdout=DEVNULL, stderr=DEVNULL, check=True,
    )


def process(task: tuple) -> tuple[str, str]:
    job, width, quality = task
    try:
        if job["kind"] == "video":
            convert_video(job, width)
        else:
            convert_image(job, width, quality)
        return ("ok", str(job["source"]))
    except Exception as error:
        return ("failed", f"{job['source']}: {error}")


def main() -> None:
    parser = ArgumentParser(description="Generate WebP thumbnails for the gallery manifest.")
    parser.add_argument("--manifest", default="site/manifest.json")
    parser.add_argument("--out", default="site/thumbs")
    parser.add_argument("--config", default=".github/config.ini")
    parser.add_argument("--jobs", type=int, default=0)
    arguments = parser.parse_args()

    manifest_path = Path(arguments.manifest)
    if not manifest_path.exists():
        exit(f"thumbgen: manifest not found at {manifest_path} (run sitegen.py first)")
    config = get_config(Path(arguments.config))
    width = int(config.get("thumb_width", "480"))
    quality = int(config.get("thumb_quality", "72"))
    manifest = loads(manifest_path.read_text())

    jobs = pending_jobs(manifest, Path(arguments.out))
    skipped = sum(category["count"] for category in manifest.get("categories", [])) - len(jobs)
    if not jobs:
        print(f"thumbgen: nothing to do ({skipped} up-to-date)")
        return
    if find_spec("PIL") is None:
        exit("thumbgen: pillow is required (python3 -m pip install pillow)")

    without_ffmpeg = [job for job in jobs if job["kind"] == "video" and which("ffmpeg") is None]
    if without_ffmpeg:
        print(f"thumbgen: ffmpeg not found, skipping {len(without_ffmpeg)} video posters", file=stderr)
        for job in without_ffmpeg:
            jobs.remove(job)

    tasks = [(job, width, quality) for job in jobs]
    workers = max(1, arguments.jobs or cpu_count() or 1)
    generated, failures = 0, []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for status, detail in pool.map(process, tasks):
            if status == "ok":
                generated += 1
            else:
                failures.append(detail)

    print(
        f"thumbgen: {generated} generated, {skipped + len(without_ffmpeg)} skipped, "
        f"{len(failures)} failed (width={width}, quality={quality}, workers={workers})"
    )
    for failure in failures:
        print(f"thumbgen: {failure}", file=stderr)


if __name__ == "__main__":
    main()
