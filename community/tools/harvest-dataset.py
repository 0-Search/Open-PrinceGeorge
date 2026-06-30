#!/usr/bin/env python3
"""
harvest-dataset.py — build the ML training dataset of (title -> ?) rows from the
City's Voting Summary tables, across ALL council terms.

Pipeline:
  1. read tools/meeting-pages.json (from discover-meetings.js)
  2. for each meeting page: get its date + Voting Summary PDF link
  3. parse the Voting Summary table -> every motion's title/result/votes
  4. write tools/ml/dataset.jsonl  (one motion per line; label added later)

Downloads are cached under a scratch dir so re-runs are cheap / resumable.
The script never touches votes.json or the website.

  python3 community/tools/harvest-dataset.py
"""

import os, re, json, io, ssl, time, urllib.request, hashlib
import pdfplumber

HERE = os.path.dirname(__file__)
PAGES = json.load(open(os.path.join(HERE, 'meeting-pages.json')))['meetings']
CACHE = '/private/tmp/claude-501/-Users-jiamulin-Desktop---programs-Web-Open-PrinceGeorge/e91464cd-dfb0-4cbe-a06c-b9a30a8ecee7/scratchpad/harvest-cache'
OUT_DIR = os.path.join(HERE, 'ml')
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
TERM_START = '2022-11-07'  # current council sworn in
VOTE_CELL = {'yes', 'no', 'absent', 'abstain', 'recused'}


def fetch(url, binary=False):
    """Fetch with on-disk cache keyed by URL hash."""
    key = hashlib.md5(url.encode()).hexdigest() + ('.bin' if binary else '.txt')
    path = os.path.join(CACHE, key)
    if os.path.exists(path):
        return open(path, 'rb').read() if binary else open(path, encoding='utf-8').read()
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    data = urllib.request.urlopen(req, context=CTX, timeout=60).read()
    if binary:
        open(path, 'wb').write(data)
        return data
    text = data.decode('utf-8', 'ignore')
    open(path, 'w', encoding='utf-8').write(text)
    return text


def page_info(url):
    """Return (date, voting_summary_pdf_url) for a meeting page, or (date, None)."""
    html = fetch(url)
    dt = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', html)
    date = dt.group(1) if dt else None
    m = re.search(r'href="([^"]*Voting_Summary[^"]*\.pdf)"', html, re.I)
    vs = m.group(1) if m else None
    if vs and vs.startswith('/'):
        vs = 'https://www.princegeorge.ca' + vs
    return date, vs


def parse_summary(pdf_bytes):
    motions = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table:
                continue
            for row in table:
                cells = [(c or '').strip() for c in row]
                decision = next((c for c in cells if c.upper() in ('CARRIED', 'DEFEATED')), None)
                title = next((c for c in cells if c.lstrip().startswith('That ')), None)
                if not decision or not title:
                    continue
                votes = [c.lower() for c in cells if c.lower() in VOTE_CELL]
                against = sum(1 for c in votes if c == 'no')
                motions.append({
                    'title': re.sub(r'\s+', ' ', title).strip(),
                    'result': 'carried' if decision.upper() == 'CARRIED' else 'defeated',
                    'against': against,
                    'divided': against > 0,
                })
    return motions


def main():
    rows, seen_titles = [], set()
    stats = {'pages': 0, 'no_summary': 0, 'parsed': 0, 'errors': 0}
    for i, page in enumerate(PAGES, 1):
        stats['pages'] += 1
        try:
            date, vs = page_info(page)
            if not vs:
                stats['no_summary'] += 1
                continue
            motions = parse_summary(fetch(vs, binary=True))
            if motions:
                stats['parsed'] += 1
            for mo in motions:
                key = (date, mo['title'])
                if key in seen_titles:
                    continue
                seen_titles.add(key)
                mo['date'] = date
                mo['term'] = 'current' if (date or '') >= TERM_START else 'previous'
                mo['source'] = vs
                rows.append(mo)
        except Exception as e:
            stats['errors'] += 1
            print(f"  ! {page.split('/')[-1]}: {e}")
        if i % 25 == 0:
            print(f"  ...{i}/{len(PAGES)} pages, {len(rows)} motions so far")

    out = os.path.join(OUT_DIR, 'dataset.jsonl')
    with open(out, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    # report
    by_year, by_term = {}, {}
    for r in rows:
        yr = (r['date'] or '????')[:4]
        by_year[yr] = by_year.get(yr, 0) + 1
        by_term[r['term']] = by_term.get(r['term'], 0) + 1
    print('\n=== harvest complete ===')
    print('stats:', stats)
    print('motions:', len(rows), '| divided:', sum(1 for r in rows if r['divided']))
    print('by term:', by_term)
    print('by year:', dict(sorted(by_year.items())))
    print('wrote', os.path.relpath(out))


if __name__ == '__main__':
    main()
