"""Venue-years that are not in a proceedings site yet, from the conference's virtual site pages.

Only pages that robots.txt allows are read: /virtual/{year}/papers.html (all accepted papers, titles
only) and /virtual/{year}/poster/{id} (title, authors, abstract). The /static/virtual/data/*.json
dumps are disallowed by robots.txt and are never used. A paper whose abstract is already in the
local arXiv harvest skips its poster-page request.
"""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, arxiv_lookup, fill_from_arxiv, dedupe_by_title, log, listing_max_age

HOSTS = {"neurips": ("https://neurips.cc", "NeurIPS"),
         "iclr": ("https://iclr.cc", "ICLR"),
         "eccv": ("https://eccv.ecva.net", "ECCV")}
YEARS = {"neurips": [2025, 2026], "iclr": [2023], "eccv": [2026]}


def _poster(http, url):
    html = http.get(url, ok_404=True) or ""
    s = BeautifulSoup(html, "html.parser")
    title = s.select_one(".event-title")
    org = s.select_one(".event-organizers")
    abs_el = s.select_one(".abstract-text-inner") or s.select_one("#abstractText")
    link = s.find("a", href=re.compile(r"openreview\.net/forum\?id="))
    return {
        "title": title.get_text(" ", strip=True) if title else "",
        "authors": [a.strip() for a in re.split(r"\s*⋅\s*", org.get_text(" ", strip=True))] if org else [],
        "abstract": abs_el.get_text(" ", strip=True) if abs_el else "",
        "forum": link["href"] if link else None,
    }


def fetch(http, venue, year):
    base, name = HOSTS[venue]
    list_url = f"{base}/virtual/{year}/papers.html"
    html = http.get(list_url, ok_404=True, max_age=listing_max_age(year))
    soup = BeautifulSoup(html or "", "html.parser")
    seen, rows = set(), []
    for a in soup.find_all("a", href=re.compile(rf"/virtual/{year}/(?:loc/[^/]+/)?poster/\d+")):
        pid = re.search(r"/poster/(\d+)", a["href"]).group(1)
        if pid in seen:
            continue
        seen.add(pid)
        rows.append((a.get_text(" ", strip=True), urljoin(base, a["href"])))
    if not rows:
        if html:
            http.forget(list_url)
        log(f"  {venue} {year}: no papers listed at {list_url}, skipped")
        return None
    papers, fetched = [], 0
    for i, (title, url) in enumerate(rows, 1):
        p = paper(title=title, authors=[], url=url)
        if not fill_from_arxiv(p, arxiv_lookup(title)):
            d = _poster(http, url)
            fetched += 1
            p["title"] = d["title"] or p["title"]
            p["authors"] = d["authors"] or p["authors"]
            p["abstract"] = d["abstract"]
            if d["forum"]:
                p["pdf"] = p["pdf"] or d["forum"].replace("/forum?", "/pdf?")
        papers.append(p)
        if i % 500 == 0:
            log(f"  {venue} {year}: {i}/{len(rows)} papers ({fetched} poster pages fetched)")
    log(f"  {venue} {year}: {fetched} poster pages fetched, {len(rows) - fetched} abstracts from arXiv")
    return dict(venue=name, year=year, source=f"{base}/virtual/{year}/", papers=dedupe_by_title(papers))
