"""arXiv papers in cs.AI / cs.CL / cs.CV / cs.LG submitted from 2024 to today, via OAI-PMH.

OAI-PMH selects by datestamp (last metadata change), not by submission date, so we harvest the
`cs` set month by month from 2024-01 up to today and bucket records by the yymm prefix of their
arXiv id (the submission month). Each completed month window is cached as compact JSON under
data/raw/arxiv-windows/, so reruns only harvest the newest window(s). arXiv asks for at most one
request every 3 seconds; Http enforces that and honours Retry-After on 503.
"""
import datetime as dt
import json
import xml.etree.ElementTree as ET

from common import RAW_DIR, paper, log

YEARS = {"arxiv": list(range(2024, dt.date.today().year + 1))}
OAI = "https://export.arxiv.org/oai2"
CATEGORIES = {"cs.AI", "cs.CL", "cs.CV", "cs.LG"}
START = dt.date(2024, 1, 1)
NS = {"oai": "http://www.openarchives.org/OAI/2.0/", "ax": "http://arxiv.org/OAI/arXiv/"}
WIN_DIR = RAW_DIR / "arxiv-windows"


def _windows(today):
    d = START
    while d <= today:
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield d, min(nxt - dt.timedelta(days=1), today)
        d = nxt


def _parse(rec):
    md = rec.find("oai:metadata/ax:arXiv", NS)
    if md is None:
        return None
    cats = (md.findtext("ax:categories", "", NS) or "").split()
    if not CATEGORIES.intersection(cats):
        return None
    authors = []
    for a in md.findall("ax:authors/ax:author", NS):
        name = " ".join(x for x in (a.findtext("ax:forenames", "", NS), a.findtext("ax:keyname", "", NS)) if x)
        authors.append(name)
    return {
        "id": md.findtext("ax:id", "", NS),
        "title": md.findtext("ax:title", "", NS),
        "authors": authors,
        "abstract": md.findtext("ax:abstract", "", NS),
        "categories": cats,
        "doi": md.findtext("ax:doi", None, NS),
    }


def _harvest_window(http, start, end, final):
    path = WIN_DIR / f"{start:%Y-%m-%d}_{end:%Y-%m-%d}.json"
    if final and path.exists() and not http.refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    params = {"verb": "ListRecords", "metadataPrefix": "arXiv", "set": "cs",
              "from": f"{start:%Y-%m-%d}", "until": f"{end:%Y-%m-%d}"}
    out, pages = [], 0
    while True:
        root = ET.fromstring(http.get(OAI, params=params, cache=False, timeout=300))
        err = root.find("oai:error", NS)
        if err is not None:
            if err.get("code") == "noRecordsMatch":
                break
            raise RuntimeError(f"arXiv OAI error {err.get('code')}: {err.text}")
        lr = root.find("oai:ListRecords", NS)
        for rec in lr.findall("oai:record", NS):
            r = _parse(rec)
            if r:
                out.append(r)
        pages += 1
        tok = lr.find("oai:resumptionToken", NS)
        if tok is None or not (tok.text or "").strip():
            break
        if pages % 10 == 0:
            log(f"    {start:%Y-%m}: {pages} pages, cursor {tok.get('cursor')} / {tok.get('completeListSize')}")
        params = {"verb": "ListRecords", "resumptionToken": tok.text.strip()}
    if final:
        WIN_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    log(f"  arxiv window {start:%Y-%m-%d}..{end:%Y-%m-%d}: {len(out)} matching records ({pages} pages)")
    return out


_records = None  # every matching record, harvested once per run and shared by all years


def _all_records(http):
    global _records
    if _records is None:
        today = dt.date.today()
        latest = {}
        for start, end in _windows(today):
            final = end < today - dt.timedelta(days=2)   # recent windows can still change
            for r in _harvest_window(http, start, end, final):
                latest[r["id"]] = r  # later windows hold the newer metadata
        _records = latest
    return _records


def fetch(http, venue, year):
    latest = _all_records(http)
    results = []
    yy = year % 100
    for month in range(1, 13):
        prefix = f"{yy:02d}{month:02d}."
        rows = sorted((r for i, r in latest.items() if i.startswith(prefix)), key=lambda r: r["id"])
        if not rows:
            continue
        papers = [paper(id=r["id"], title=r["title"], authors=r["authors"], abstract=r["abstract"],
                        url=f"https://arxiv.org/abs/{r['id']}", pdf=f"https://arxiv.org/pdf/{r['id']}",
                        arxiv_id=r["id"], doi=r["doi"], categories=r["categories"]) for r in rows]
        results.append(dict(name=f"arxiv-{year}-{month:02d}", venue="arXiv", year=year,
                            source="https://arxiv.org/", papers=papers,
                            extra={"month": month, "categories": sorted(CATEGORIES)}))
    return results or None
