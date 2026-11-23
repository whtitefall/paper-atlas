"""IJCAI main-track papers from ijcai.org/proceedings.

The proceedings page lists the main-track paper numbers; each paper has a small JSON record
({n}.json) with title, authors, abstract and DOI (one request per paper, cached).
"""
import re

from bs4 import BeautifulSoup

from common import paper, log

YEARS = {"ijcai": [2023, 2024, 2025]}
BASE = "https://ijcai.org/proceedings/{year}/"


def fetch(http, venue, year):
    base = BASE.format(year=year)
    html = http.get(base, ok_404=True)
    if not html:
        log(f"  ijcai {year}: proceedings page not found, skipped")
        return None
    soup = BeautifulSoup(html, "html.parser")
    main = None
    for sec in soup.select("div.section"):
        t = sec.select_one(".section_title")
        if t and t.get_text(strip=True).lower() == "main track":
            main = sec
            break
    if main is None:
        log(f"  ijcai {year}: no 'Main Track' section found, skipped")
        return None
    nums = []
    for a in main.select("a.title, .paper_wrapper a[href]"):
        m = re.search(rf"/proceedings/{year}/(\d+)/?$", a.get("href", ""))
        if m and m.group(1) not in nums:
            nums.append(m.group(1))
    papers = []
    for i, n in enumerate(nums, 1):
        if i % 200 == 0:
            log(f"  ijcai {year}: {i}/{len(nums)} papers")
        rec = http.get_json(f"{base}{n}.json", ok_404=True)
        if not rec:
            continue
        pdf = None
        enc = rec.get("encoding") or rec.get("pdf")
        if isinstance(enc, dict):
            pdf = enc.get("contentUrl")
        elif isinstance(enc, str):
            pdf = enc
        doi = rec.get("doi")
        if not doi and isinstance(rec.get("identifier"), dict):
            doi = rec["identifier"].get("value")
        papers.append(paper(
            title=rec.get("title") or rec.get("name") or "",
            authors=[a.get("name", "") for a in rec.get("authors") or rec.get("author") or []],
            abstract=rec.get("abstract") or "",
            url=f"{base}{n}",
            pdf=pdf or f"{base}{int(n):04d}.pdf",
            doi=doi,
        ))
    return dict(venue="IJCAI", year=year, source=base, papers=papers)
