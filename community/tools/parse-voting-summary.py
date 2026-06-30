#!/usr/bin/env python3
"""
parse-voting-summary.py — read a Council "Voting Summary" PDF (a structured
table) and pull out every motion: its text, the result, and each councillor's
Yes/No. This is cleaner and more complete than parsing the minutes prose,
because the City already tabulated the votes.

Table columns (left to right):
  Agenda Item | Description | Resolution | <one column per councillor> | Decision | Count

We rely on pdfplumber to keep the columns separate (pypdf would flatten them).

  python3 community/tools/parse-voting-summary.py <voting-summary-pdf-url-or-path>
"""

import sys, re, json, io, ssl, urllib.request
import pdfplumber

VOTE_CELL = {'yes', 'no', 'absent', 'abstain', 'recused'}


def load(src):
    if src.startswith('http'):
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        raw = urllib.request.urlopen(urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'}), context=ctx, timeout=60).read()
        return pdfplumber.open(io.BytesIO(raw))
    return pdfplumber.open(src)


def parse(src):
    motions = []
    with load(src) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table:
                continue
            for row in table:
                cells = [(c or '').strip() for c in row]
                # A real motion row has a CARRIED/DEFEATED decision cell ...
                decision = next((c for c in cells if c.upper() in ('CARRIED', 'DEFEATED')), None)
                if not decision:
                    continue
                # ... and a resolution cell (the motion text, starts with "That").
                title = next((c for c in cells if c.lstrip().startswith('That ')), None)
                if not title:
                    continue
                votes = [c for c in cells if c.lower() in VOTE_CELL]
                against = sum(1 for c in votes if c.lower() == 'no')
                motions.append({
                    'title': re.sub(r'\s+', ' ', title).strip(),
                    'result': 'carried' if decision.upper() == 'CARRIED' else 'defeated',
                    'votes_recorded': len(votes),
                    'against': against,
                    'divided': against > 0,
                })
    return motions


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: parse-voting-summary.py <pdf-url-or-path>'); sys.exit(2)
    ms = parse(sys.argv[1])
    print(json.dumps(ms, indent=2, ensure_ascii=False))
