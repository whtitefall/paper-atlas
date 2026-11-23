"""ICML from PMLR (proceedings.mlr.press): one BibTeX file per volume, abstracts included.

One request per year.
"""
import re

from common import paper, delatex, arxiv_from_url, log, listing_max_age

YEARS = {"icml": [2023, 2024, 2025, 2026]}
VOLUMES = {2023: "v202", 2024: "v235", 2025: "v267", 2026: "v306"}
BIB = "https://proceedings.mlr.press/{vol}/assets/bib/bibliography.bib"


def _entries(bib):
    """Yield (type, {field: raw value}) for each @Type{key, field = {...}, ...} entry."""
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", bib):
        etype, pos, fields = m.group(1).lower(), m.end(), {}
        while True:
            fm = re.compile(r"\s*(\w+)\s*=\s*").match(bib, pos)
            if not fm:
                break
            name, pos = fm.group(1).lower(), fm.end()
            if pos < len(bib) and bib[pos] == "{":
                depth, start = 0, pos
                while pos < len(bib):
                    depth += {"{": 1, "}": -1}.get(bib[pos], 0)
                    pos += 1
                    if depth == 0:
                        break
                value = bib[start + 1:pos - 1]
            elif pos < len(bib) and bib[pos] == '"':
                end = bib.index('"', pos + 1)
                value, pos = bib[pos + 1:end], end + 1
            else:
                vm = re.compile(r"[^,}\s]+").match(bib, pos)
                value, pos = (vm.group(0), vm.end()) if vm else ("", pos)
            fields[name] = value
            cm = re.compile(r"\s*,").match(bib, pos)
            if not cm:
                break
            pos = cm.end()
        yield etype, fields


def _authors(raw):
    out = []
    for a in re.split(r"\s+and\s+", raw):
        last, _, first = delatex(a).partition(",")
        out.append(f"{first.strip()} {last.strip()}".strip() if first else last.strip())
    return out


def fetch(http, venue, year):
    vol = VOLUMES[year]
    bib = http.get(BIB.format(vol=vol), ok_404=True, max_age=listing_max_age(year))
    if not bib:
        log(f"  icml {year}: PMLR {vol} bibliography not found, skipped")
        return None
    papers = []
    for etype, f in _entries(bib):
        if etype != "inproceedings" or not f.get("title"):
            continue
        papers.append(paper(
            title=delatex(f["title"]),
            authors=_authors(f.get("author", "")),
            abstract=delatex(f.get("abstract", "")),
            url=f.get("url", ""),
            pdf=f.get("pdf"),
            arxiv_id=arxiv_from_url(f.get("software", "")) or None,
        ))
    return dict(venue="ICML", year=year, source=f"https://proceedings.mlr.press/{vol}/", papers=papers)
