"""Build the static "atlas" the website reads, from the fetchers' output.

Input:  data/papers/*.json         (one file per venue-year, or arxiv-YYYY-MM; see scripts/README.md)
Output: public/data/atlas/
          index.json        datasets, clusters, embedding info
          {key}.json        papers of one dataset: id, title, authors, year, x, y, cluster, url, pdf
          {key}.abs.json    abstracts of that dataset, same order (loaded lazily by the site)
          {key}.kw.json     a few salient terms per paper, same order (topic search without abstracts)
          {key}.nn.bin      K nearest neighbours of every paper (global indices + similarity)

Every paper lives in one shared 2D space, so any selection of venues/years is a subset of the same map.

Usage:
  python scripts/build_atlas.py                       # TF-IDF + SVD embeddings (no model download)
  python scripts/build_atlas.py --embed minilm        # sentence-transformers all-MiniLM-L6-v2
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
from pathlib import Path

import warnings

import numpy as np

warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', message='n_jobs value')

ROOT = Path(__file__).resolve().parent.parent
K_NN = 20

# venue key -> (display name, kind). Anything else is treated as a conference.
VENUES = {
    'aaai': ('AAAI', 'conf'), 'ijcai': ('IJCAI', 'conf'), 'neurips': ('NeurIPS', 'conf'),
    'icml': ('ICML', 'conf'), 'iclr': ('ICLR', 'conf'), 'cvpr': ('CVPR', 'conf'),
    'iccv': ('ICCV', 'conf'), 'eccv': ('ECCV', 'conf'), 'acl': ('ACL', 'conf'),
    'emnlp': ('EMNLP', 'conf'), 'naacl': ('NAACL', 'conf'), 'kdd': ('KDD', 'conf'),
    'www': ('WWW', 'conf'), 'sigir': ('SIGIR', 'conf'),
    'tpami': ('TPAMI', 'journal'), 'ijcv': ('IJCV', 'journal'), 'jmlr': ('JMLR', 'journal'),
    'tacl': ('TACL', 'journal'), 'arxiv': ('arXiv', 'preprint'),
}


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def norm_title(t: str) -> str:
    return re.sub(r'[^\w]+', ' ', t.lower()).strip()


def load_papers(papers_dir: Path):
    """Read fetcher outputs, group into datasets, drop arXiv copies of venue papers."""
    datasets = {}
    for f in sorted(papers_dir.glob('*.json')):
        if f.name == 'index.json':  # the fetchers' file listing, not a dataset
            continue
        data = json.loads(f.read_text(encoding='utf-8'))
        stem = f.stem  # e.g. cvpr-2024, arxiv-2024-03, arxiv-2024-03-part2
        vkey = stem.split('-')[0].lower()
        name, kind = VENUES.get(vkey, (data.get('venue') or vkey.upper(), 'conf'))
        m = re.match(r'^[a-z]+-(\d{4})(?:-(\d{2}))?(?:-part\d+)?$', stem)
        year = int(m.group(1)) if m else int(data.get('year') or 0)
        month = int(m.group(2)) if m and m.group(2) else (data.get('month') or None)
        papers = [p for p in data.get('papers', []) if p.get('title')]
        datasets[stem] = {'key': stem, 'venue': name, 'vkey': vkey, 'kind': kind, 'year': year, 'month': month, 'papers': papers}
        log(f'loaded {stem}: {len(papers)} papers')

    # Venue papers win over their arXiv preprints (matched by arXiv id or title).
    venue_arxiv, venue_titles = set(), set()
    for d in datasets.values():
        if d['kind'] == 'preprint':
            continue
        for p in d['papers']:
            if p.get('arxiv_id'):
                venue_arxiv.add(p['arxiv_id'].split('v')[0])
            venue_titles.add(norm_title(p['title']))
    for d in datasets.values():
        if d['kind'] != 'preprint':
            continue
        before = len(d['papers'])
        d['papers'] = [p for p in d['papers']
                       if (p.get('arxiv_id') or p.get('id', '')).split('v')[0] not in venue_arxiv
                       and norm_title(p['title']) not in venue_titles]
        if before != len(d['papers']):
            log(f'{d["key"]}: dropped {before - len(d["papers"])} preprints already in a venue')

    # Within each dataset, drop exact duplicate titles.
    for d in datasets.values():
        seen, keep = set(), []
        for p in d['papers']:
            k = norm_title(p['title'])
            if k in seen:
                continue
            seen.add(k)
            keep.append(p)
        d['papers'] = keep

    order = sorted((d for d in datasets.values() if d['papers']), key=lambda d: (d['kind'] == 'preprint', d['vkey'], d['year'], d['month'] or 0))
    return order


def tfidf(texts):
    """TF-IDF over unigrams and bigrams; used for the TF-IDF embedding and for per-paper keywords."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    log('TF-IDF…')
    vec = TfidfVectorizer(max_features=80000, ngram_range=(1, 2), min_df=min(3, max(1, len(texts) // 1000)),
                          max_df=0.5, sublinear_tf=True, stop_words='english', dtype=np.float32)
    X = vec.fit_transform(texts).tocsr()
    return X, vec.get_feature_names_out()


def embed_svd(X, dims=192):
    from sklearn.decomposition import TruncatedSVD
    from sklearn.preprocessing import normalize
    dims = min(dims, X.shape[1] - 1, X.shape[0] - 1)
    log(f'SVD to {dims} dims…')
    Z = TruncatedSVD(n_components=dims, random_state=42).fit_transform(X)
    return normalize(Z).astype(np.float32)


def keywords(X, vocab, top=8):
    """The highest-weighted TF-IDF terms of each paper, skipping generic words and overlapping n-grams."""
    log('keywords…')
    bad = np.array([t in GENERIC or any(w in GENERIC for w in t.split()) for t in vocab])
    out = []
    for i in range(X.shape[0]):
        s, e = X.indptr[i], X.indptr[i + 1]
        cols, vals = X.indices[s:e], X.data[s:e]
        terms, seen = [], []
        for j in np.argsort(-vals):
            c = cols[j]
            if bad[c]:
                continue
            words = set(vocab[c].split())
            if any(words <= w or w <= words for w in seen):  # keep one of "graph" / "graph neural"
                continue
            terms.append(vocab[c])
            seen.append(words)
            if len(terms) == top:
                break
        out.append('; '.join(terms))
    return out


def embed_minilm(texts, ids, cache_path: Path):
    from sentence_transformers import SentenceTransformer
    cache = {}
    if cache_path.exists():
        z = np.load(cache_path, allow_pickle=False)
        cache = dict(zip(z['ids'].tolist(), z['emb']))
    todo = [i for i, pid in enumerate(ids) if pid not in cache]
    log(f'MiniLM: {len(ids) - len(todo)} cached, {len(todo)} to embed')
    if todo:
        model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
        emb = model.encode([texts[i] for i in todo], batch_size=128, show_progress_bar=False, normalize_embeddings=True)
        for i, e in zip(todo, emb):
            cache[ids[i]] = e.astype(np.float32)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(cache_path, ids=np.array(list(cache.keys())), emb=np.stack(list(cache.values())))
    return np.stack([cache[pid] for pid in ids]).astype(np.float32)


def layout_umap(Z, fit_sample=60000):
    import umap
    n = len(Z)
    nn = max(2, min(15, n - 1))
    reducer = umap.UMAP(n_components=2, n_neighbors=nn, min_dist=0.08, metric='cosine', random_state=42)
    if n <= fit_sample:
        log(f'UMAP on {n} points…')
        return reducer.fit_transform(Z)
    rng = np.random.default_rng(42)
    idx = rng.choice(n, fit_sample, replace=False)
    log(f'UMAP fit on {fit_sample} of {n} points…')
    reducer.fit(Z[idx])
    out = np.zeros((n, 2), dtype=np.float32)
    for s in range(0, n, 50000):
        log(f'UMAP transform {s}…')
        out[s:s + 50000] = reducer.transform(Z[s:s + 50000])
    return out


def knn(Z, k=K_NN):
    n = len(Z)
    k = min(k, n - 1)
    if n <= 30000:
        log(f'exact kNN on {n} points…')
        idx = np.zeros((n, k), dtype=np.int32)
        sim = np.zeros((n, k), dtype=np.float32)
        for s in range(0, n, 2048):
            S = Z[s:s + 2048] @ Z.T
            for r in range(S.shape[0]):
                S[r, s + r] = -2  # not yourself
            top = np.argpartition(-S, k, axis=1)[:, :k]
            ts = np.take_along_axis(S, top, axis=1)
            o = np.argsort(-ts, axis=1)
            idx[s:s + 2048] = np.take_along_axis(top, o, axis=1)
            sim[s:s + 2048] = np.take_along_axis(ts, o, axis=1)
        return idx, sim
    from pynndescent import NNDescent
    log(f'approximate kNN on {n} points…')
    index = NNDescent(Z, metric='cosine', n_neighbors=k + 1, random_state=42)
    I, D = index.neighbor_graph
    return I[:, 1:].astype(np.int32), (1 - D[:, 1:]).astype(np.float32)


# Words too generic to label a research topic.
GENERIC = {
    'paper', 'propose', 'proposed', 'approach', 'approaches', 'method', 'methods', 'results', 'result', 'model',
    'models', 'task', 'tasks', 'performance', 'data', 'dataset', 'datasets', 'learning', 'based', 'using', 'use',
    'work', 'show', 'shows', 'new', 'study', 'novel', 'framework', 'existing', 'state', 'art', 'state art',
    'experiments', 'experimental', 'demonstrate', 'significantly', 'effective', 'effectiveness', 'improve',
    'improves', 'improved', 'improvement', 'achieve', 'achieves', 'various', 'different', 'problem', 'problems',
    'paper propose', 'code', 'available', 'github', 'com', 'https', 'http', 'publicly', 'released', 'outperforms',
    'extensive', 'benchmark', 'benchmarks', 'previous', 'prior', 'recent', 'recently', 'challenging', 'challenge',
    'introduce', 'present', 'presents', 'given', 'provide', 'provides', 'large', 'high', 'quality', 'end',
}


def clusters(Z, texts, xy, k=None):
    from sklearn.cluster import KMeans, MiniBatchKMeans
    from sklearn.feature_extraction.text import CountVectorizer
    n = len(Z)
    k = k or int(min(60, max(6, round(math.sqrt(n / 40)))))
    log(f'k-means with k={k}…')
    km = (MiniBatchKMeans(n_clusters=k, random_state=42, batch_size=4096, n_init=3) if n > 20000
          else KMeans(n_clusters=k, random_state=42, n_init=4))
    labels = km.fit_predict(Z)
    # c-TF-IDF: terms frequent in a cluster but rare across clusters
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
    cv = CountVectorizer(ngram_range=(1, 2), stop_words=list(ENGLISH_STOP_WORDS | GENERIC), min_df=min(5, max(1, n // 2000)), max_df=0.4, max_features=60000)
    X = cv.fit_transform(texts)
    vocab = np.array(cv.get_feature_names_out())
    import scipy.sparse as sp
    M = sp.csr_matrix((np.ones(n), (labels, np.arange(n))), shape=(k, n)) @ X  # k x V term counts
    M = M.toarray().astype(np.float64)
    tf = M / np.maximum(M.sum(axis=1, keepdims=True), 1)
    idf = np.log(1 + M.sum(axis=1).mean() / np.maximum(M.sum(axis=0), 1))
    score = tf * idf
    out = []
    for c in range(k):
        members = np.where(labels == c)[0]
        terms = []
        for j in np.argsort(-score[c]):
            t = vocab[j]
            if t in GENERIC or any(w in GENERIC for w in t.split()):
                continue
            # skip a unigram already covered by a chosen bigram, and vice versa
            if any(t in s or s in t for s in terms):
                continue
            terms.append(t)
            if len(terms) == 3:
                break
        cx, cy = np.median(xy[members], axis=0) if len(members) else (0, 0)
        out.append({'id': c, 'terms': terms, 'x': round(float(cx), 1), 'y': round(float(cy), 1), 'n': int(len(members))})
    return labels, out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--papers', default=str(ROOT / 'data/papers'))
    ap.add_argument('--out', default=str(ROOT / 'public/data/atlas'))
    ap.add_argument('--embed', choices=['tfidf', 'minilm'], default='tfidf')
    ap.add_argument('--clusters', type=int, default=None)
    ap.add_argument('--fit-sample', type=int, default=60000)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    datasets = load_papers(Path(args.papers))
    if not datasets:
        sys.exit('no papers found; run the fetchers first (scripts/README.md)')
    papers = [p for d in datasets for p in d['papers']]
    n = len(papers)
    log(f'{n} papers in {len(datasets)} datasets')
    texts = [f"{p['title']}. {p['title']}. {p.get('abstract') or ''}" for p in papers]

    X, vocab = tfidf(texts)
    if args.embed == 'minilm':
        Z = embed_minilm(texts, [p['id'] for p in papers], ROOT / 'data/cache/emb-minilm.npz')
    else:
        Z = embed_svd(X)
    kw = keywords(X, vocab)
    del X
    xy = layout_umap(Z, args.fit_sample)
    # scale to a 0..1000 box (y up), rounded for compact JSON
    lo, hi = xy.min(axis=0), xy.max(axis=0)
    xy = (xy - lo) / np.maximum(hi - lo, 1e-9) * 1000
    labels, cluster_info = clusters(Z, texts, xy, args.clusters)
    nn_idx, nn_sim = knn(Z)

    offset = 0
    index = {
        'version': 1,
        'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'embed': args.embed, 'n': n, 'k_nn': int(nn_idx.shape[1]),
        'datasets': [], 'clusters': cluster_info,
    }
    for d in datasets:
        m = len(d['papers'])
        rows, abstracts = [], []
        for i, p in enumerate(d['papers']):
            g = offset + i
            authors = p.get('authors') or []
            rows.append([
                p.get('id') or f"{d['key']}-{i}", p['title'],
                ', '.join(authors[:12]) + (' …' if len(authors) > 12 else ''),
                round(float(xy[g, 0]), 1), round(float(xy[g, 1]), 1), int(labels[g]),
                p.get('url') or '', p.get('pdf') or '',
            ])
            abstracts.append(p.get('abstract') or '')
        meta = {'key': d['key'], 'venue': d['venue'], 'kind': d['kind'], 'year': d['year'], 'month': d['month'], 'n': m, 'offset': offset}
        (out / f"{d['key']}.json").write_text(json.dumps({**meta, 'cols': ['id', 'title', 'authors', 'x', 'y', 'c', 'url', 'pdf'], 'rows': rows}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        (out / f"{d['key']}.abs.json").write_text(json.dumps(abstracts, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        (out / f"{d['key']}.kw.json").write_text(json.dumps(kw[offset:offset + m], ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        sl = slice(offset, offset + m)
        with open(out / f"{d['key']}.nn.bin", 'wb') as fh:
            fh.write(np.ascontiguousarray(nn_idx[sl], dtype='<i4').tobytes())
            fh.write(np.clip(np.round(nn_sim[sl] * 255), 0, 255).astype(np.uint8).tobytes())
        index['datasets'].append(meta)
        offset += m
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    log(f'wrote {len(datasets)} datasets to {out}')


if __name__ == '__main__':
    main()
