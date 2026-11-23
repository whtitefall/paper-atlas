"""NeurIPS and ICLR from their official proceedings sites (proceedings.neurips.cc,
proceedings.iclr.cc), which have no robots.txt restrictions.

The year page lists every paper with title and authors (one request). Abstracts are on one page
per paper; a paper whose abstract is already in the local arXiv harvest skips that request.
"""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, arxiv_lookup, fill_from_arxiv, log, listing_max_age

HOSTS = {"neurips": ("https://proceedings.neurips.cc", "NeurIPS"),
         "iclr": ("https://proceedings.iclr.cc", "ICLR")}
# NeurIPS 2025+ and ICLR 2023 are not (fully) on these sites yet; see sources/virtual.py.
YEARS = {"neurips": [2023, 2024], "iclr": [2024, 2025, 2026]}


def fetch(http, venue, year):
    base, name = HOSTS[venue]
    list_url = f"{base}/paper_files/paper/{year}"
    html = http.get(list_url, ok_404=True, max_age=listing_max_age(year))
    soup = BeautifulSoup(html or "", "html.parser")
    items = soup.select("ul.paper-list li") or soup.select("li")
    rows = []
    for li in items:
        a = li.find("a", href=re.compile(r"/hash/.+-Abstract"))
        if not a:
            continue
        au = li.select_one(".paper-authors") or li.find("i")
        rows.append((a.get_text(), urljoin(base, a["href"]),
                     [x.strip() for x in (au.get_text() if au else "").split(",") if x.strip()]))
    if not rows:
        if html:
            http.forget(list_url)
        log(f"  {venue} {year}: no papers on {list_url}, skipped")
        return None
    papers, fetched = [], 0
    for i, (title, url, authors) in enumerate(rows, 1):
        p = paper(title=title, authors=authors, url=url,
                  pdf=re.sub(r"-Abstract-(.+)\.html$", r"-Paper-\1.pdf", url.replace("/hash/", "/file/")))
        if not fill_from_arxiv(p, arxiv_lookup(title)):
            page = http.get(url, ok_404=True)
            fetched += 1
            el = BeautifulSoup(page or "", "html.parser").select_one(".paper-abstract")
            if not el:  # older page layout: the abstract is the paragraph after <h4>Abstract</h4>
                h4 = BeautifulSoup(page or "", "html.parser").find(["h4", "h2"], string=re.compile("Abstract"))
                el = h4.find_next("p") if h4 else None
            p["abstract"] = el.get_text(" ", strip=True) if el else ""
        papers.append(p)
        if i % 500 == 0:
            log(f"  {venue} {year}: {i}/{len(rows)} papers ({fetched} abstract pages fetched)")
    log(f"  {venue} {year}: {fetched} abstract pages fetched, {len(rows) - fetched} abstracts from arXiv")
    return dict(venue=name, year=year, source=f"{base}/", papers=papers)
