"""ECCV 2024 from the ECVA open-access listing (www.ecva.net/papers.php).

The listing (one request, all ECCV years) gives title, authors, PDF and DOI; abstracts are on one
page per paper, skipped when the local arXiv harvest already has the abstract.
"""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, arxiv_lookup, fill_from_arxiv, log

YEARS = {"eccv": [2024]}   # ECCV 2026 is not on ecva.net yet; see sources/virtual.py
BASE = "https://www.ecva.net/"


def fetch(http, venue, year):
    html = http.get(BASE + "papers.php")
    soup = BeautifulSoup(html, "html.parser")
    papers, fetched = [], 0
    entries = [dt for dt in soup.select("dt.ptitle")
               if dt.find("a", href=re.compile(rf"eccv_{year}/"))]
    if not entries:
        log(f"  eccv {year}: not on ecva.net yet, skipped")
        return None
    for i, dt in enumerate(entries, 1):
        a = dt.find("a")
        dd = dt.find_next_sibling("dd")
        dd2 = dd.find_next_sibling("dd") if dd else None
        authors = [x.strip().rstrip("*") for x in (dd.get_text() if dd else "").split(",") if x.strip()]
        pdf = dd2.find("a", string="pdf") if dd2 else None
        doi = dd2.find("a", string="DOI") if dd2 else None
        url = urljoin(BASE, a["href"].strip())
        p = paper(title=a.get_text(), authors=authors, url=url,
                  pdf=urljoin(BASE, pdf["href"]) if pdf else None,
                  doi=re.sub(r"^https?://(dx\.)?doi\.org/", "", doi["href"]) if doi and "doi.org" in doi["href"] else None)
        if not fill_from_arxiv(p, arxiv_lookup(p["title"])):
            page = http.get(url, ok_404=True) or ""
            fetched += 1
            el = BeautifulSoup(page, "html.parser").select_one("#abstract")
            p["abstract"] = el.get_text(" ", strip=True).strip('"“” ') if el else ""
        papers.append(p)
        if i % 500 == 0:
            log(f"  eccv {year}: {i}/{len(entries)} papers ({fetched} abstract pages fetched)")
    log(f"  eccv {year}: {fetched} abstract pages fetched, {len(entries) - fetched} abstracts from arXiv")
    return dict(venue="ECCV", year=year, source=BASE + "papers.php", papers=papers)
