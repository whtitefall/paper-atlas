"""NeurIPS / ICLR / ICML / CVPR / ICCV / ECCV accepted papers from the conferences' own virtual sites.

These sites run the same "miniconf" software and publish every accepted paper (title, authors,
abstract, links) as one JSON file, so a whole venue-year costs a single request instead of one
request per paper. CVPR/ICCV entries are enriched with PDF and arXiv links from the CVF
open-access listing (one more request).
"""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from common import paper, dedupe_by_title, title_key, arxiv_from_url, log

HOSTS = {
    "neurips": ("neurips.cc", "NeurIPS"),
    "iclr": ("iclr.cc", "ICLR"),
    "icml": ("icml.cc", "ICML"),
    "cvpr": ("cvpr.thecvf.com", "CVPR"),
    "iccv": ("iccv.thecvf.com", "ICCV"),
    "eccv": ("eccv.ecva.net", "ECCV"),
}
YEARS = {
    "neurips": [2023, 2024, 2025],
    "iclr": [2023, 2024, 2025],
    "icml": [2023, 2024, 2025],
    "cvpr": [2023, 2024, 2025],
    "iccv": [2025],           # ICCV 2023 has no miniconf dump; see sources/cvf.py
    "eccv": [2024],
}
JSON_URL = "https://{host}/static/virtual/data/{venue}-{year}-orals-posters.json"
CVF_LIST = "https://openaccess.thecvf.com/{VENUE}{year}?day=all"


def _none(v):
    return None if v in (None, "", "None") else v


def _pdf_for(paper_url, pdf_url):
    if _none(pdf_url):
        return pdf_url
    u = _none(paper_url) or ""
    if "proceedings.neurips.cc" in u and "/hash/" in u:
        return re.sub(r"-Abstract-(.+)\.html$", r"-Paper-\1.pdf", u.replace("/hash/", "/file/"))
    if "openreview.net/forum" in u:
        return u.replace("/forum?", "/pdf?")
    if "openaccess.thecvf.com" in u and "/html/" in u:
        return u.replace("/html/", "/papers/").replace(".html", ".pdf")
    return None


def cvf_listing(http, venue, year):
    """title_key -> {url, pdf, arxiv_id} from the CVF open-access listing (CVPR/ICCV only)."""
    html = http.get(CVF_LIST.format(VENUE=venue.upper(), year=year), ok_404=True)
    if not html:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    out = {}
    for dt in soup.select("dt.ptitle"):
        a = dt.find("a")
        if not a:
            continue
        dd = dt.find_next_sibling("dd")
        dd2 = dd.find_next_sibling("dd") if dd else None
        links = {x.get_text(strip=True).lower(): x.get("href") for x in (dd2.find_all("a") if dd2 else [])}
        base = "https://openaccess.thecvf.com"
        out[title_key(a.get_text())] = {
            "url": urljoin(base, a["href"]),
            "pdf": urljoin(base, links["pdf"]) if links.get("pdf") else None,
            "arxiv_id": arxiv_from_url(links.get("arxiv")),
        }
    return out


def fetch(http, venue, year):
    host, name = HOSTS[venue]
    data = http.get_json(JSON_URL.format(host=host, venue=venue, year=year), ok_404=True)
    if data is None:
        log(f"  {venue} {year}: no virtual-site data (404), skipped")
        return None
    cvf = cvf_listing(http, venue, year) if venue in ("cvpr", "iccv") else {}
    papers = []
    for r in data.get("results", []):
        if r.get("eventtype") not in ("Poster", "Oral", "Spotlight", "Highlight"):
            continue
        if "reject" in str(r.get("decision") or "").lower():
            continue
        paper_url = _none(r.get("paper_url"))
        virt = _none(r.get("virtualsite_url"))
        url = paper_url or (f"https://{host}{virt}" if virt else "")
        extra = cvf.get(title_key(r.get("name") or ""), {})
        papers.append(paper(
            title=r.get("name") or "",
            authors=[a.get("fullname", "") for a in r.get("authors") or []],
            abstract=_none(r.get("abstract")) or "",
            url=extra.get("url") or url,
            pdf=extra.get("pdf") or _pdf_for(paper_url, r.get("paper_pdf_url")),
            arxiv_id=extra.get("arxiv_id"),
        ))
    papers = dedupe_by_title(papers)   # orals are listed twice (oral + poster session)
    return dict(venue=name, year=year, source=f"https://{host}/", papers=papers)
