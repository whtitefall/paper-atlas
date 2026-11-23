"""ICCV 2023 from the CVF open-access site (no miniconf dump exists for it).

The listing page gives titles, authors, PDF and arXiv links; abstracts need one request per paper
page (about 2,100 requests, cached, so an interrupted run resumes where it stopped).
"""
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, arxiv_from_url, log

YEARS = {"iccv": [2023]}
BASE = "https://openaccess.thecvf.com"
NAMES = {"iccv": "ICCV", "cvpr": "CVPR"}


def fetch(http, venue, year):
    html = http.get(f"{BASE}/{venue.upper()}{year}?day=all", ok_404=True)
    if not html:
        log(f"  {venue} {year}: no CVF listing, skipped")
        return None
    soup = BeautifulSoup(html, "html.parser")
    entries = soup.select("dt.ptitle")
    papers = []
    for i, dt in enumerate(entries, 1):
        a = dt.find("a")
        if not a:
            continue
        dd = dt.find_next_sibling("dd")
        dd2 = dd.find_next_sibling("dd") if dd else None
        authors = [x.get("value", "") for x in dd.select("input[name=query_author]")] if dd else []
        links = {x.get_text(strip=True).lower(): x.get("href") for x in (dd2.find_all("a") if dd2 else [])}
        page_url = urljoin(BASE, a["href"])
        if i % 200 == 0:
            log(f"  {venue} {year}: {i}/{len(entries)} paper pages")
        page = http.get(page_url, ok_404=True) or ""
        abs_el = BeautifulSoup(page, "html.parser").find(id="abstract") if page else None
        papers.append(paper(
            title=a.get_text(),
            authors=authors,
            abstract=abs_el.get_text() if abs_el else "",
            url=page_url,
            pdf=urljoin(BASE, links["pdf"]) if links.get("pdf") else None,
            arxiv_id=arxiv_from_url(links.get("arxiv")),
        ))
    return dict(venue=NAMES.get(venue, venue.upper()), year=year, source=BASE + "/", papers=papers)
