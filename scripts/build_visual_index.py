"""Build a compact perceptual fingerprint index from TCGdex card thumbnails.

Run manually when refreshing the catalogue. Only hashes and card IDs are published.
Dependencies: aiohttp, opencv-python, numpy.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from urllib.request import urlopen

import aiohttp
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "visual-index-cache.jsonl"
OUTPUT = ROOT / "public" / "card-features.json"
API = "https://api.tcgdex.net/v2/fr/cards"


def phash(image: np.ndarray) -> str:
    resized = cv2.resize(image, (32, 32), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY).astype(np.float32)
    coeff = cv2.dct(gray)[:8, :8]
    threshold = np.median(coeff.flatten()[1:])
    bits = (coeff.flatten() > threshold).tolist()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def features(raw: bytes) -> list[str] | None:
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None
    h, w = image.shape[:2]
    art = image[int(h * .17):int(h * .65), int(w * .06):int(w * .94)]
    return [phash(image), phash(art)]


async def main():
    cards = json.load(urlopen(API, timeout=30))
    cards = [card for card in cards if card.get("image")]
    done = {}
    if CACHE.exists():
        for line in CACHE.read_text(encoding="utf8").splitlines():
            try:
                record = json.loads(line)
                done[record[0]] = record
            except (json.JSONDecodeError, IndexError):
                pass
    pending = [card for card in cards if card["id"] not in done]
    print(f"Cards with images: {len(cards)}; cached: {len(done)}; pending: {len(pending)}", flush=True)
    semaphore = asyncio.Semaphore(12)
    timeout = aiohttp.ClientTimeout(total=20)
    connector = aiohttp.TCPConnector(limit=12)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers={"User-Agent": "Pok-Stock fingerprint index builder"}) as session:
        async def download(card):
            async with semaphore:
                url = card["image"] + "/low.webp"
                for attempt in range(3):
                    try:
                        async with session.get(url) as response:
                            if response.status == 404:
                                return [card["id"]]
                            response.raise_for_status()
                            result = features(await response.read())
                            return [card["id"], *result] if result else [card["id"]]
                    except (aiohttp.ClientError, asyncio.TimeoutError):
                        await asyncio.sleep(1 + attempt * 2)
                return [card["id"]]

        tasks = [asyncio.create_task(download(card)) for card in pending]
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        with CACHE.open("a", encoding="utf8") as cache:
            for index, task in enumerate(asyncio.as_completed(tasks), 1):
                record = await task
                done[record[0]] = record
                cache.write(json.dumps(record, separators=(",", ":")) + "\n")
                if index % 500 == 0:
                    cache.flush()
                    print(f"Processed {index}/{len(pending)}", flush=True)
    OUTPUT.parent.mkdir(exist_ok=True)
    compact = [done[card["id"]] for card in cards if len(done.get(card["id"], [])) == 3]
    OUTPUT.write_text(json.dumps(compact, separators=(",", ":")), encoding="utf8")
    print(f"Wrote {len(compact)} fingerprints to {OUTPUT}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
