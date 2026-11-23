"""AAAI technical-track papers via the OJS OAI-PMH endpoint of ojs.aaai.org.

We keep records whose dc:source names the volume for the requested year and a "Technical Track"
issue (special programs, IAAI, EAAI, student abstracts and demos are skipped).

OAI-PMH selects records by datestamp (their last change), so we harvest month by month from 2022-12
to today, which keeps every list short. One long list failed: the server answered HTTP 500 for every
page after the 100th. When a span keeps failing anyway, it is split in half and both halves are
harvested again, down to a single second, so a record the server can't return only costs the few
records that changed in the same second. Finished months are cached as compact JSON under
data/raw/aaai-windows/ together with the spans that failed, and later runs retry only those spans
and harvest the newest month again.
"""
import datetime as dt
import json
import re
import xml.etree.ElementTree as ET

from common import RAW_DIR, RobotsDisallowed, paper, log

YEARS = {"aaai": list(range(2023, dt.date.today().year + 1))}
OAI = "https://ojs.aaai.org/index.php/AAAI/oai"
NS = {"oai": "http://www.openarchives.org/OAI/2.0/", "dc": "http://purl.org/dc/elements/1.1/",
      "oai_dc": "http://www.openarchives.org/OAI/2.0/oai_dc/"}
START = dt.datetime(2022, 12, 1)
WIN_DIR = RAW_DIR / "aaai-windows"
DAY = dt.timedelta(days=1)
MAX_FAILURES = 80  # failed spans per run; after that, failing spans are skipped without splitting


def volume(year):
    return year - 1986  # AAAI-23 is Vol. 37


def _fmt(t, step):
    return f"{t:%Y-%m-%dT%H:%M:%SZ}" if step < DAY else f"{t:%Y-%m-%d}"


def _time(s):
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ" if "T" in s else "%Y-%m-%d")


def _keep_newest(latest, records):
    """Add records to {id: record}, keeping the copy with the newest datestamp."""
    for r in records:
        old = latest.get(r["id"])
        if old is None or r["datestamp"] >= old["datestamp"]:
            latest[r["id"]] = r
    return latest


def _parse(rec):
    """One OAI record as a small dict; deleted records keep only their id and datestamp."""
    h = rec.find("oai:header", NS)
    r = {"id": h.findtext("oai:identifier", "", NS), "datestamp": h.findtext("oai:datestamp", "", NS)}
    if h.get("status") == "deleted":
        r["deleted"] = True
        return r
    md = rec.find("oai:metadata/oai_dc:dc", NS)
    if md is None:
        return None
    ids = [i.text or "" for i in md.findall("dc:identifier", NS)]
    rel = [x.text or "" for x in md.findall("dc:relation", NS)]
    authors = []
    for c in md.findall("dc:creator", NS):
        last, _, first = (c.text or "").partition(",")
        authors.append(f"{first.strip()} {last.strip()}".strip())
    r.update(
        title=md.findtext("dc:title", "", NS),
        authors=authors,
        abstract=md.findtext("dc:description", "", NS),
        url=next((i for i in ids if i.startswith("http")), ""),
        doi=next((i for i in ids if i.startswith("10.")), None),
        pdf=next((x.replace("/article/view/", "/article/download/") for x in rel if "/article/view/" in x), None),
        sources=[s.text or "" for s in md.findall("dc:source", NS)],
    )
    return r


class Harvester:
    def __init__(self, http):
        self.http = http
        self.failures = 0
        identify = ET.fromstring(http.get(OAI, params={"verb": "Identify"}, max_age=30 * DAY.total_seconds()))
        granularity = identify.findtext("oai:Identify/oai:granularity", "", NS)
        self.step = dt.timedelta(seconds=1) if "hh:mm:ss" in granularity else DAY  # smallest span

    def _list(self, a, b, retries):
        """Yield every record that changed in [a, b]; raises when the server keeps failing."""
        params = {"verb": "ListRecords", "metadataPrefix": "oai_dc",
                  "from": _fmt(a, self.step), "until": _fmt(b, self.step)}
        while True:
            root = ET.fromstring(self.http.get(OAI, params=params, cache=False, retries=retries))
            err = root.find("oai:error", NS)
            if err is not None:
                if err.get("code") == "noRecordsMatch":
                    return
                raise RuntimeError(f"OAI error {err.get('code')}: {err.text}")
            lr = root.find("oai:ListRecords", NS)
            if lr is None:
                raise RuntimeError("OAI response without ListRecords")
            for rec in lr.findall("oai:record", NS):
                r = _parse(rec)
                if r:
                    yield r
            tok = lr.find("oai:resumptionToken", NS)
            if tok is None or not (tok.text or "").strip():
                return
            params = {"verb": "ListRecords", "resumptionToken": tok.text.strip()}

    def _alive(self):
        try:
            self.http.get(OAI, params={"verb": "Identify"}, cache=False, retries=2)
            return True
        except RobotsDisallowed:
            raise
        except RuntimeError:
            return False

    def span(self, a, b, retries=5, top=True):
        """Records that changed in [a, b], and the sub-spans that could not be harvested."""
        out = []
        try:
            for r in self._list(a, b, retries):
                out.append(r)  # kept if a later page fails; the halves below may return it again
            return out, []
        except RobotsDisallowed:
            raise
        except (RuntimeError, ET.ParseError) as e:
            error = e
        self.failures += 1
        if top and not self._alive():
            raise RuntimeError(f"{OAI} is not answering: {error}")
        if b <= a or self.failures > MAX_FAILURES:
            log(f"  ! aaai: skipped records changed {_fmt(a, self.step)}..{_fmt(b, self.step)}: {error}")
            return out, [(a, b)]
        n = (b - a) // self.step
        mid = a + (n // 2) * self.step
        first, failed1 = self.span(a, mid, retries=1, top=False)
        second, failed2 = self.span(mid + self.step, b, retries=1, top=False)
        return out + first + second, failed1 + failed2

    def months(self, now):
        """(first, last) of every calendar month from START to now, in the server's granularity."""
        end_now = now if self.step < DAY else now.replace(hour=0, minute=0, second=0)
        start = START
        while start <= now:
            nxt = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
            yield start, min(nxt - self.step, end_now)
            start = nxt

    def month(self, start, end, final):
        """Records of one month window. Finished months are cached with the spans that failed;
        on later runs only those spans are tried again."""
        path = WIN_DIR / f"{start:%Y-%m}.json"
        records, spans, retries = [], [(start, end)], 5
        if final and path.exists() and not self.http.refresh:
            saved = json.loads(path.read_text(encoding="utf-8"))
            if not saved["failed"]:
                return saved["records"], 0
            records, spans, retries = saved["records"], [(_time(a), _time(b)) for a, b in saved["failed"]], 1
            log(f"  aaai {start:%Y-%m}: retrying {len(spans)} span(s) that failed before")
        failed = []
        for a, b in spans:
            got, bad = self.span(a, b, retries)
            records += got
            failed += bad
        records = list(_keep_newest({}, records).values())
        if final:
            WIN_DIR.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")  # write-then-rename, so an interrupted run leaves no half file
            tmp.write_text(json.dumps({"records": records,
                                       "failed": [[_fmt(a, self.step), _fmt(b, self.step)] for a, b in failed]},
                                      ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
        if records or failed:
            log(f"  aaai {start:%Y-%m}: {len(records)} records" + (f", {len(failed)} span(s) failed" if failed else ""))
        return records, len(failed)


def _harvest(http):
    hv = Harvester(http)
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)
    latest, n_failed = {}, 0
    for start, end in hv.months(now):
        final = end < now - 2 * DAY  # recent months can still change
        records, failed = hv.month(start, end, final)
        n_failed += failed
        _keep_newest(latest, records)  # a record that changed again also shows up in a later month
    if n_failed:
        log(f"  aaai: {n_failed} span(s) could not be harvested; they are retried on the next run")
    return [r for r in latest.values() if not r.get("deleted")]


_records = None  # every record, harvested once per run and shared by all years
_error = None


def _all_records(http):
    global _records, _error
    if _error:
        raise RuntimeError(f"the AAAI harvest failed earlier in this run: {_error}")
    if _records is None:
        try:
            _records = _harvest(http)
        except Exception as e:
            _error = e
            raise
    return _records


def _article_number(r):
    m = re.search(r"(\d+)$", r["id"])
    return int(m.group(1)) if m else 0


def fetch(http, venue, year):
    vol = volume(year)
    vol_re = re.compile(rf"Vol\. {vol} No\. \d+: AAAI-\d\d .*Technical Track", re.I)
    rows = sorted((r for r in _all_records(http) if any(vol_re.search(s) for s in r["sources"])),
                  key=_article_number)
    if not rows:
        log(f"  aaai {year}: no technical-track records for Vol. {vol}, skipped")
        return None
    papers = [paper(title=r["title"], authors=r["authors"], abstract=r["abstract"],
                    url=r["url"], pdf=r["pdf"], doi=r["doi"]) for r in rows]
    return dict(venue="AAAI", year=year, source="https://ojs.aaai.org/index.php/AAAI", papers=papers)
