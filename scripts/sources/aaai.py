"""AAAI technical-track papers via the OJS OAI-PMH endpoint of ojs.aaai.org.

OAI-PMH pages through every record (100 per page); we keep records whose dc:source names the
volume for the requested year and a "Technical Track" issue (special programs, IAAI, EAAI,
student abstracts and demos are skipped).
"""
import re
import xml.etree.ElementTree as ET

from common import paper, log

YEARS = {"aaai": [2023, 2024, 2025]}
OAI = "https://ojs.aaai.org/index.php/AAAI/oai"
NS = {"oai": "http://www.openarchives.org/OAI/2.0/", "dc": "http://purl.org/dc/elements/1.1/",
      "oai_dc": "http://www.openarchives.org/OAI/2.0/oai_dc/"}
VOLUME = {2023: 37, 2024: 38, 2025: 39}


def harvest(http):
    """Yield every oai_dc record published since 2022-12 (all years share one cached harvest)."""
    params = {"verb": "ListRecords", "metadataPrefix": "oai_dc", "from": "2022-12-01"}
    page = 0
    while True:
        page += 1
        root = ET.fromstring(http.get(OAI, params=params))
        err = root.find("oai:error", NS)
        if err is not None:
            if err.get("code") == "noRecordsMatch":
                return
            raise RuntimeError(f"OAI error {err.get('code')}: {err.text}")
        lr = root.find("oai:ListRecords", NS)
        for rec in lr.findall("oai:record", NS):
            yield rec
        tok = lr.find("oai:resumptionToken", NS)
        if tok is None or not (tok.text or "").strip():
            return
        if page % 20 == 0:
            log(f"  aaai: harvested {page} OAI pages (list size {tok.get('completeListSize')})")
        params = {"verb": "ListRecords", "resumptionToken": tok.text.strip()}


def fetch(http, venue, year):
    vol = VOLUME[year]
    vol_re = re.compile(rf"Vol\. {vol} No\. \d+: AAAI-\d\d .*Technical Track", re.I)
    papers = []
    for rec in harvest(http):
        md = rec.find("oai:metadata/oai_dc:dc", NS)
        if md is None:
            continue
        sources = [s.text or "" for s in md.findall("dc:source", NS)]
        if not any(vol_re.search(s) for s in sources):
            continue
        ids = [i.text or "" for i in md.findall("dc:identifier", NS)]
        url = next((i for i in ids if i.startswith("http")), "")
        doi = next((i for i in ids if i.startswith("10.")), None)
        rel = [r.text or "" for r in md.findall("dc:relation", NS)]
        pdf = next((r.replace("/article/view/", "/article/download/") for r in rel if "/article/view/" in r), None)
        authors = []
        for c in md.findall("dc:creator", NS):
            last, _, first = (c.text or "").partition(",")
            authors.append(f"{first.strip()} {last.strip()}".strip())
        papers.append(paper(
            title=(md.findtext("dc:title", "", NS)),
            authors=authors,
            abstract=md.findtext("dc:description", "", NS),
            url=url, pdf=pdf, doi=doi,
        ))
    if not papers:
        log(f"  aaai {year}: no technical-track records for Vol. {vol}, skipped")
        return None
    return dict(venue="AAAI", year=year, source="https://ojs.aaai.org/index.php/AAAI", papers=papers)
