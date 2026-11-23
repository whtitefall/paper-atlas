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
from urllib.robotparser import RobotFileParser

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "papers"  # raw inputs for build_atlas.py; not published

USER_AGENT = "paper-atlas-fetcher (+https://github.com/whtitefall/paper-atlas)"
DEFAULT_INTERVAL = 1.0          # seconds between requests to the same host
HOST_INTERVAL = {"export.arxiv.org": 3.0, "arxiv.org": 3.0}
# URLs allowed despite robots.txt. export.arxiv.org disallows all crawling in robots.txt, but arXiv
# documents its OAI-PMH endpoint there for bulk metadata harvesting
# (https://info.arxiv.org/help/oa/index.html), which is exactly what sources/arxiv.py does.
ROBOTS_EXCEPTIONS = ("https://export.arxiv.org/oai2",)


class RobotsDisallowed(RuntimeError):
    pass
MAX_FILE_BYTES = 50 * 1024 * 1024
WEEK = 7 * 24 * 3600


def listing_max_age(year: int) -> float | None:
    """Cache lifetime for a venue-year's listing: a week for this year and later (it may still
    grow or be published), forever for earlier years."""
    return WEEK if year >= dt.date.today().year else None


def log(*args):
    print(*args, file=sys.stderr, flush=True)


class Http:
    """requests wrapper: per-host rate limit, retry with backoff, on-disk cache under data/raw/."""

    def __init__(self, refresh: bool = False):
        self.refresh = refresh
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self.requests_made = 0

    def _robots_for(self, scheme: str, host: str) -> RobotFileParser | None:
        """Fetch (once per run, cached on disk for a week) and parse a host's robots.txt.
        None means no usable robots.txt, i.e. everything is allowed."""
        if host in self._robots:
            return self._robots[host]
        url = f"{scheme}://{host}/robots.txt"
        path = self._cache_path(url, None)
        text = None
        if path.exists() and time.time() - path.stat().st_mtime < WEEK:
            text = path.read_text(encoding="utf-8")
        else:
            self._wait(host)
            try:
                r = self.session.get(url, timeout=60)
                self.requests_made += 1
                # many sites serve robots.txt as text/html, so judge by the body, not the header
                if r.status_code == 200 and not r.text.lstrip().startswith("<"):
                    text = r.text
                elif r.status_code in (401, 403):
                    text = "User-agent: *\nDisallow: /\n"   # treat as fully disallowed (RFC 9309)
                else:
                    text = ""                                # 404 / HTML error page: no rules
            except requests.RequestException as e:
                log(f"  ! could not read {url}: {e}; assuming no rules")
                text = ""
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        rp = None
        if text.strip():
            rp = RobotFileParser()
            rp.parse(text.splitlines())
            delay = rp.crawl_delay(USER_AGENT)
            if delay:
                HOST_INTERVAL[host] = max(float(delay), HOST_INTERVAL.get(host, DEFAULT_INTERVAL))
        self._robots[host] = rp
        return rp

    def allowed(self, url: str) -> bool:
        if url.startswith(ROBOTS_EXCEPTIONS):
            return True
        u = urlparse(url)
        rp = self._robots_for(u.scheme, u.netloc)
        return rp is None or rp.can_fetch(USER_AGENT, url)

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

    def forget(self, url: str, params: dict | None = None):
        """Drop a cached response, e.g. a listing that turned out to be empty or not final yet."""
        self._cache_path(url, params).unlink(missing_ok=True)

    def get(self, url: str, *, cache: bool = True, params: dict | None = None,
            ok_404: bool = False, retries: int = 5, timeout: int = 120,
            max_age: float | None = None) -> str | None:
        """GET `url` and return the body as text. Returns None on 404 when ok_404 is set
        (a 404 is never cached). With `max_age` (seconds), an older cached copy is refetched."""
        if not self.allowed(url):
            raise RobotsDisallowed(f"robots.txt disallows {url}")
        path = self._cache_path(url, params)
        if cache and not self.refresh and path.exists():
            if max_age is None or time.time() - path.stat().st_mtime < max_age:
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
            if r.url != url and not self.allowed(r.url):   # redirected somewhere disallowed
                raise RobotsDisallowed(f"robots.txt disallows {r.url} (redirected from {url})")
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


# ---------- arXiv title matching ----------

_arxiv_by_title: dict | None = None
_arxiv_by_id: dict | None = None


def _load_arxiv():
    """Index the month windows cached by sources/arxiv.py by normalised title and by id."""
    global _arxiv_by_title, _arxiv_by_id
    if _arxiv_by_title is None:
        by_title: dict[str, dict] = {}
        by_id: dict[str, dict] = {}
        for path in sorted((RAW_DIR / "arxiv-windows").glob("*.json")):
            try:
                records = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:  # e.g. an interrupted older run
                log(f"  ! skipping unreadable {path.name}: {e}")
                continue
            for r in records:
                by_id[r["id"]] = r                # later windows hold newer metadata
                k = title_key(r["title"])
                if len(k) >= 20:                  # skip very short / generic titles
                    by_title[k] = r
        _arxiv_by_title, _arxiv_by_id = by_title, by_id
        if by_id:
            log(f"  (arXiv index: {len(by_id)} local records for title matching)")


def arxiv_lookup(title: str = "", arxiv_id: str | None = None) -> dict | None:
    """The local arXiv record for a paper, by arXiv id if known, else by exact normalised title."""
    _load_arxiv()
    if arxiv_id and arxiv_id in _arxiv_by_id:
        return _arxiv_by_id[arxiv_id]
    return _arxiv_by_title.get(title_key(title)) if title else None


def fill_from_arxiv(p: dict, r: dict | None) -> bool:
    """Copy missing fields from arXiv record `r` into paper `p`. True if the abstract was filled."""
    if not r:
        return False
    filled = False
    if not p["abstract"] and r.get("abstract"):
        p["abstract"] = clean(r["abstract"]); filled = True
    if not p["authors"] and r.get("authors"):
        p["authors"] = [clean(a) for a in r["authors"]]
    if not p["arxiv_id"]:
        p["arxiv_id"] = r["id"]
    p["pdf"] = p["pdf"] or f"https://arxiv.org/pdf/{r['id']}"
    return filled


def enrich_from_arxiv(papers: list[dict]) -> tuple[int, int]:
    """Fill missing abstracts / authors / arXiv ids of venue papers from the local arXiv harvest.
    Returns (abstracts filled, arXiv ids filled)."""
    n_abs = n_ids = 0
    for p in papers:
        had_id = bool(p["arxiv_id"])
        r = arxiv_lookup(p["title"], p["arxiv_id"])
        if fill_from_arxiv(p, r):
            n_abs += 1
        n_ids += bool(r) and not had_id
    return n_abs, n_ids


# ---------- LaTeX (BibTeX) cleanup ----------

_ACCENTS = {"`": "\u0300", "'": "\u0301", "^": "\u0302", '"': "\u0308", "~": "\u0303", "=": "\u0304",
            ".": "\u0307", "u": "\u0306", "v": "\u030c", "H": "\u030b", "c": "\u0327", "k": "\u0328"}
_SPECIAL = {"ss": "ß", "o": "ø", "O": "Ø", "l": "ł", "L": "Ł", "aa": "å", "AA": "Å", "ae": "æ", "AE": "Æ",
            "oe": "œ", "OE": "Œ", "i": "ı", "j": "ȷ"}
_ACCENT_RE = re.compile(r"""\\([`'^"~=.uvHck])\s*\{?\\?([A-Za-z])\}?""")
_SPECIAL_RE = re.compile(r"\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L|i|j)(?![A-Za-z])\s?")


def delatex(s: str) -> str:
    """Turn common BibTeX/LaTeX text escapes into Unicode and drop grouping braces (math is kept)."""
    s = _ACCENT_RE.sub(lambda m: unicodedata.normalize("NFC", m.group(2) + _ACCENTS[m.group(1)]), s)
    s = _SPECIAL_RE.sub(lambda m: _SPECIAL[m.group(1)], s)
    s = re.sub(r"\\([&%_#$])", r"\1", s)
    s = re.sub(r"\\(?:textit|textbf|emph|textrm|texttt|textsc)\{", "{", s)
    return clean(s.replace("{", "").replace("}", "").replace("---", "—").replace("--", "–"))
