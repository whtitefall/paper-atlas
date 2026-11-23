"""Shared helpers for the paper fetchers: polite cached HTTP, text cleanup, output writing."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "papers"  # raw inputs for build_atlas.py; not published

USER_AGENT = "paper-atlas-fetcher (+https://github.com/whtitefall/paper-atlas)"
DEFAULT_INTERVAL = 1.0          # seconds between requests to the same host
HOST_INTERVAL = {"export.arxiv.org": 3.0, "arxiv.org": 3.0}
MAX_FILE_BYTES = 50 * 1024 * 1024


def log(*args):
    print(*args, file=sys.stderr, flush=True)


class Http:
    """requests wrapper: per-host rate limit, retry with backoff, on-disk cache under data/raw/."""

    def __init__(self, refresh: bool = False):
        self.refresh = refresh
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last: dict[str, float] = {}
        self.requests_made = 0

    def _cache_path(self, url: str, data: dict | None) -> Path:
        host = urlparse(url).netloc or "local"
        key = url if data is None else url + "?" + json.dumps(data, sort_keys=True)
        return RAW_DIR / host / (hashlib.sha1(key.encode()).hexdigest() + ".cache")

    def _wait(self, host: str):
        gap = HOST_INTERVAL.get(host, DEFAULT_INTERVAL)
        elapsed = time.monotonic() - self._last.get(host, 0)
        if elapsed < gap:
            time.sleep(gap - elapsed)
        self._last[host] = time.monotonic()

    def get(self, url: str, *, cache: bool = True, params: dict | None = None,
            ok_404: bool = False, retries: int = 5, timeout: int = 120) -> str | None:
        """GET `url` and return the body as text. Returns None on 404 when ok_404 is set."""
        path = self._cache_path(url, params)
        if cache and not self.refresh and path.exists():
            return path.read_text(encoding="utf-8")
        host = urlparse(url).netloc
        delay = 5.0
        for attempt in range(1, retries + 1):
            self._wait(host)
            try:
                self.requests_made += 1
                r = self.session.get(url, params=params, timeout=timeout)
            except requests.RequestException as e:
                log(f"  ! {url}: {e} (attempt {attempt}/{retries})")
                time.sleep(delay); delay *= 2
                continue
            if r.status_code == 404 and ok_404:
                return None
            if r.status_code in (429, 500, 502, 503, 504):
                wait = r.headers.get("Retry-After")
                wait = float(wait) if wait and wait.isdigit() else delay
                log(f"  ! {url}: HTTP {r.status_code}, waiting {wait:.0f}s (attempt {attempt}/{retries})")
                time.sleep(wait); delay *= 2
                continue
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code} for {r.url}: {r.text[:300]}")
            r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
            text = r.text
            if cache:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, path)
            return text
        raise RuntimeError(f"giving up on {url} after {retries} attempts")

    def get_json(self, url: str, **kw):
        text = self.get(url, **kw)
        return None if text is None else json.loads(text)


# ---------- text helpers ----------

_ws = re.compile(r"\s+")


def clean(s: str | None) -> str:
    return _ws.sub(" ", s or "").strip()


def slugify(s: str, max_len: int = 80) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:max_len].rstrip("-") or "untitled"


def title_key(s: str) -> str:
    """Normalised title used to match the same paper across sources."""
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", s).lower())


ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", re.I)


def arxiv_from_url(url: str | None) -> str | None:
    m = ARXIV_RE.search(url or "")
    return m.group(1) if m else None


def paper(*, title, authors, abstract="", url="", pdf=None, arxiv_id=None, doi=None, id=None, categories=None):
    p = {
        "id": id,
        "title": clean(title),
        "authors": [clean(a) for a in authors if clean(a)],
        "abstract": clean(abstract),
        "url": url or "",
        "pdf": pdf or None,
        "arxiv_id": arxiv_id or None,
        "doi": doi or None,
    }
    if categories is not None:
        p["categories"] = categories
    return p


def assign_ids(papers: list[dict], prefix: str) -> list[dict]:
    """Use the arXiv id when known, else `{prefix}-{title-slug}`; make ids unique."""
    seen: dict[str, int] = {}
    for p in papers:
        base = p.get("id") or p.get("arxiv_id") or f"{prefix}-{slugify(p['title'])}"
        n = seen.get(base, 0) + 1
        seen[base] = n
        p["id"] = base if n == 1 else f"{base}-{n}"
    return papers


def dedupe_by_title(papers: list[dict]) -> list[dict]:
    """Keep one entry per title, preferring the one with an abstract / more fields filled."""
    best: dict[str, dict] = {}
    order: list[str] = []
    for p in papers:
        k = title_key(p["title"])
        if not k:
            continue
        score = lambda q: (bool(q["abstract"]), bool(q["pdf"]), bool(q["arxiv_id"]), len(q["authors"]))
        if k not in best:
            best[k] = p; order.append(k)
        elif score(p) > score(best[k]):
            best[k] = p
    return [best[k] for k in order]


# ---------- output ----------

def write_output(name: str, *, venue: str, year: int, source: str, papers: list[dict],
                 extra: dict | None = None) -> list[Path]:
    """Write data/papers/{name}.json (split into -partN files if over ~50 MB)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob(f"{name}.json"):
        old.unlink()
    for old in OUT_DIR.glob(f"{name}-part*.json"):
        old.unlink()
    head = {"venue": venue, "year": year, "source": source,
            "fetched_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()}
    if extra:
        head.update(extra)

    def dump(ps):
        return json.dumps({**head, "papers": ps}, ensure_ascii=False, separators=(",", ":"))

    body = dump(papers)
    if len(body.encode()) <= MAX_FILE_BYTES:
        chunks = [papers]
    else:
        n = len(body.encode()) // MAX_FILE_BYTES + 1
        size = -(-len(papers) // n)
        chunks = [papers[i:i + size] for i in range(0, len(papers), size)]
    paths = []
    for i, chunk in enumerate(chunks, 1):
        path = OUT_DIR / (f"{name}.json" if len(chunks) == 1 else f"{name}-part{i}.json")
        path.write_text(dump(chunk) if len(chunks) > 1 else body, encoding="utf-8")
        paths.append(path)
    with_abs = sum(1 for p in papers if p["abstract"])
    pct = 100 * with_abs / len(papers) if papers else 0
    size_mb = sum(p.stat().st_size for p in paths) / 1e6
    log(f"  -> {name}: {len(papers)} papers, abstracts {pct:.1f}%, {size_mb:.1f} MB")
    return paths


def write_index():
    """data/papers/index.json: one entry per output file (a summary of what has been fetched)."""
    entries = []
    for path in sorted(OUT_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        ps = d.get("papers", [])
        e = {"file": path.name, "venue": d.get("venue"), "year": d.get("year"),
             "count": len(ps), "with_abstract": sum(1 for p in ps if p.get("abstract")),
             "bytes": path.stat().st_size, "fetched_at": d.get("fetched_at")}
        if "month" in d:
            e["month"] = d["month"]
        entries.append(e)
    (OUT_DIR / "index.json").write_text(json.dumps({"files": entries}, ensure_ascii=False, indent=1), encoding="utf-8")
    return entries
