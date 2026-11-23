"""ACL / EMNLP / NAACL main-conference long and short papers, from the ACL Anthology XML on GitHub.

One request per venue-year (the whole proceedings collection is a single XML file).
"""
import xml.etree.ElementTree as ET

from common import paper, log, arxiv_from_url, listing_max_age

XML_URL = "https://raw.githubusercontent.com/acl-org/acl-anthology/master/data/xml/{year}.{venue}.xml"
VOLUMES = ("long", "short", "main")  # EMNLP publishes long+short together as "main"
NAMES = {"acl": "ACL", "emnlp": "EMNLP", "naacl": "NAACL"}
YEARS = {"acl": [2023, 2024, 2025, 2026], "emnlp": [2023, 2024, 2025, 2026],
         "naacl": [2024, 2025]}  # no NAACL in 2023 or 2026


def _text(el):
    return "".join(el.itertext()) if el is not None else ""


def _author(a):
    first = _text(a.find("first")).strip()
    last = _text(a.find("last")).strip()
    return f"{first} {last}".strip()


def fetch(http, venue, year):
    url = XML_URL.format(year=year, venue=venue)
    xml = http.get(url, ok_404=True, max_age=listing_max_age(year))
    if xml is None:
        log(f"  {venue} {year}: not in the ACL Anthology (404), skipped")
        return None
    root = ET.fromstring(xml)
    papers = []
    for vol in root.findall("volume"):
        if vol.get("id") not in VOLUMES:
            continue
        for p in vol.findall("paper"):
            anth = f"{year}.{venue}-{vol.get('id')}.{p.get('id')}"
            landing = f"https://aclanthology.org/{anth}/"
            arxiv = None
            for el in p.iter():
                if el.tag in ("attachment", "video", "url") and el.get("href"):
                    arxiv = arxiv or arxiv_from_url(el.get("href"))
            papers.append(paper(
                title=_text(p.find("title")),
                authors=[_author(a) for a in p.findall("author")],
                abstract=_text(p.find("abstract")),
                url=landing,
                pdf=f"https://aclanthology.org/{anth}.pdf" if p.find("pdf") is not None else None,
                doi=_text(p.find("doi")).strip() or None,
                arxiv_id=arxiv,
            ))
    if not papers:
        http.forget(url)
        log(f"  {venue} {year}: no long/short volumes found yet, skipped")
        return None
    return dict(venue=NAMES[venue], year=year, source="https://aclanthology.org/", papers=papers)
