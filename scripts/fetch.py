"""Fetch accepted-paper metadata for top AI venues and arXiv into data/papers/.

Usage:
  python scripts/fetch.py --venue cvpr --year 2024
  python scripts/fetch.py --venue acl            # every supported year of one venue
  python scripts/fetch.py --all                  # everything (arXiv takes the longest)
  python scripts/fetch.py --all --skip arxiv
  python scripts/fetch.py --list                 # show supported venue-years

Raw responses are cached under data/raw/, so reruns only fetch what is missing.
Pass --refresh to ignore the cache.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import Http, assign_ids, enrich_from_arxiv, write_output, write_index, log  # noqa: E402
from sources import acl, pmlr, proceedings, virtual, cvf, ecva, aaai, ijcai, arxiv  # noqa: E402

# venue key -> [(module, year), ...]
REGISTRY: dict[str, list] = {}
for mod in (acl, pmlr, proceedings, virtual, cvf, ecva, aaai, ijcai, arxiv):
    for venue, years in mod.YEARS.items():
        REGISTRY.setdefault(venue, []).extend((mod, y) for y in years)
for jobs in REGISTRY.values():
    jobs.sort(key=lambda j: j[1])
ORDER = ["acl", "emnlp", "naacl", "neurips", "icml", "iclr", "cvpr", "iccv", "eccv", "aaai", "ijcai", "arxiv"]


def run_one(http, mod, venue, year):
    log(f"[{venue} {year}] via {mod.__name__.split('.')[-1]}")
    t0 = time.time()
    result = mod.fetch(http, venue, year)
    if result is None:
        return []
    results = result if isinstance(result, list) else [result]
    written = []
    for r in results:
        name = r.pop("name", f"{venue}-{year}")
        papers = r.pop("papers")
        if venue != "arxiv":
            n_abs, n_ids = enrich_from_arxiv(papers)
            if n_abs or n_ids:
                log(f"  arXiv title match: +{n_abs} abstracts, +{n_ids} arXiv ids")
        papers = assign_ids(papers, prefix=f"{venue}{year}")
        written += write_output(name, papers=papers, **r)
    log(f"  done in {time.time() - t0:.0f}s ({http.requests_made} requests so far)")
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--venue", choices=sorted(REGISTRY))
    ap.add_argument("--year", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--skip", nargs="*", default=[], help="venue keys to skip with --all")
    ap.add_argument("--refresh", action="store_true", help="ignore cached raw responses")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for v in ORDER:
            print(f"{v:8s} " + ", ".join(f"{y}" for _, y in REGISTRY[v]))
        return
    if not args.all and not args.venue:
        ap.error("pass --venue (optionally with --year) or --all")

    jobs = []
    venues = [v for v in ORDER if v not in args.skip] if args.all else [args.venue]
    for v in venues:
        for mod, y in REGISTRY[v]:
            if args.year and y != args.year:
                continue
            jobs.append((mod, v, y))
    if not jobs:
        ap.error(f"{args.venue} {args.year} is not supported; see --list")

    http = Http(refresh=args.refresh)
    failures = []
    for mod, v, y in jobs:
        try:
            run_one(http, mod, v, y)
        except Exception as e:  # keep going; report at the end
            log(f"  FAILED {v} {y}: {e}")
            failures.append((v, y, str(e)))
    write_index()
    if failures:
        log("\nFailures:")
        for v, y, e in failures:
            log(f"  {v} {y}: {e[:200]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
