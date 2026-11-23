"""CVPR and ICCV from the CVF open-access site (openaccess.thecvf.com, no robots.txt restrictions).

The listing page gives titles, authors, PDF and arXiv links (one request). Abstracts are on one page
per paper; a paper whose abstract is in the local arXiv harvest (matched by its arXiv link or its
title) skips that request. Pages are cached, so an interrupted run resumes where it stopped.
"""
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, arxiv_from_url, arxiv_lookup, fill_from_arxiv, log, listing_max_age

YEARS = {"cvpr": [2023, 2024, 2025, 2026], "iccv": [2023, 2025]}
BASE = "https://openaccess.thecvf.com"
NAMES = {"iccv": "ICCV", "cvpr": "CVPR"}


def fetch(http, venue, year):
    list_url = f"{BASE}/{venue.upper()}{year}?day=all"
    html = http.get(list_url, ok_404=True, max_age=listing_max_age(year))
    if html and "ptitle" not in html:
        http.forget(list_url)
        html = None
    if not html:
        log(f"  {venue} {year}: no CVF listing, skipped")
        return None
    soup = BeautifulSoup(html, "html.parser")
    entries = soup.select("dt.ptitle")
    papers, fetched = [], 0
    for i, dt in enumerate(entries, 1):
        a = dt.find("a")
        if not a:
            continue
        dd = dt.find_next_sibling("dd")
        dd2 = dd.find_next_sibling("dd") if dd else None
        authors = [x.get("value", "") for x in dd.select("input[name=query_author]")] if dd else []
        links = {x.get_text(strip=True).lower(): x.get("href") for x in (dd2.find_all("a") if dd2 else [])}
        page_url = urljoin(BASE, a["href"])
        p = paper(title=a.get_text(), authors=authors, url=page_url,
                  pdf=urljoin(BASE, links["pdf"]) if links.get("pdf") else None,
                  arxiv_id=arxiv_from_url(links.get("arxiv")))
        if not fill_from_arxiv(p, arxiv_lookup(p["title"], p["arxiv_id"])):
            page = http.get(page_url, ok_404=True) or ""
            fetched += 1
            abs_el = BeautifulSoup(page, "html.parser").find(id="abstract") if page else None
            p["abstract"] = abs_el.get_text(" ", strip=True) if abs_el else ""
        papers.append(p)
        if i % 500 == 0:
            log(f"  {venue} {year}: {i}/{len(entries)} papers ({fetched} abstract pages fetched)")
    log(f"  {venue} {year}: {fetched} abstract pages fetched, {len(papers) - fetched} abstracts from arXiv")
    return dict(venue=NAMES[venue], year=year, source=BASE + "/", papers=papers)
