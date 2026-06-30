#!/usr/bin/env python3
"""
parse-minutes.py — STAGE 3 of the scraper: read one minutes PDF, extract the
DIVIDED votes in the same shape as data/votes.json.

How council minutes record a vote (learned by reading real PDFs):
  * "PRESENT:" lists who attended; anyone on the roster not listed is absent.
  * Each motion reads "Moved By ... Seconded By ... That <text>" then a result.
  * "Carried Unanimously"  -> everyone agreed; NOT a divided vote, skipped.
  * "Carried" / "Defeated" (no "Unanimously") -> divided; the dissenters are
    named on the next line, e.g. "Mayor Yu and Councillors Klassen, Sampson,
    and Scott opposed."

This is a first-pass parser. It prints what it finds as JSON; it does NOT write
to votes.json. Whether its output matches the hand-curated truth is exactly
what the back-test checks.

  python3 community/tools/parse-minutes.py <minutes-pdf-url-or-path>
"""

import sys, re, json, io, ssl, urllib.request, os

HERE = os.path.dirname(__file__)
COUNCILLORS = json.load(open(os.path.join(HERE, '..', 'data', 'councillors.json')))

# surname (lowercased) -> councillor id, e.g. "yu" -> "simon_yu"
SURNAME_TO_ID = {p['name'].split()[-1].lower(): p['id'] for p in COUNCILLORS['councillors']}
ALL_IDS = set(SURNAME_TO_ID.values())


def load_text_by_page(src):
    """Return a list of page texts. src can be a URL or a local file path."""
    import pypdf
    if src.startswith('http'):
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
        raw = urllib.request.urlopen(req, context=ctx, timeout=60).read()
        reader = pypdf.PdfReader(io.BytesIO(raw))
    else:
        reader = pypdf.PdfReader(src)
    return [pg.extract_text() for pg in reader.pages]


def parse_date(text):
    """Pull the meeting date from the header, e.g. 'May 25, 2026' -> 2026-05-25."""
    m = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})', text)
    if not m:
        return None
    months = ['january','february','march','april','may','june','july','august','september','october','november','december']
    mo = months.index(m.group(1).lower()) + 1
    return f"{m.group(3)}-{mo:02d}-{int(m.group(2)):02d}"


def parse_present(text):
    """Councillors listed under PRESENT (plus the Mayor)."""
    block = re.search(r'PRESENT:(.*?)(IN ATTENDANCE:|_{5,}|A\.\s)', text, re.S)
    present = set()
    if block:
        for sur, cid in SURNAME_TO_ID.items():
            if re.search(r'\b' + re.escape(sur.capitalize()) + r'\b', block.group(1)):
                present.add(cid)
    return present


def names_to_ids(fragment):
    """From '...Yu and Councillors Klassen, Sampson, and Scott' -> set of ids."""
    ids = set()
    for sur, cid in SURNAME_TO_ID.items():
        if re.search(r'\b' + re.escape(sur.capitalize()) + r'\b', fragment):
            ids.add(cid)
    return ids


def parse(src):
    pages = load_text_by_page(src)
    full = ''.join(pages)
    date = parse_date(pages[0])
    present = parse_present(pages[0])
    absent = ALL_IDS - present

    # character offset where each page starts, so we can report a page number
    page_starts, off = [], 0
    for t in pages:
        page_starts.append(off); off += len(t)
    def page_of(pos):
        p = 1
        for i, start in enumerate(page_starts):
            if pos >= start: p = i + 1
        return p

    votes, seq = [], 0
    # Each motion begins at "Moved By"; the result/opposed text follows. The
    # "...opposed." line can sit one or more (possibly blank) lines below the
    # result, so we scan a short window of following text rather than just the
    # next line. [\s\S]{0,160}? is "up to ~160 chars, non-greedy".
    for m in re.finditer(r'Moved By.*?That\s+(.*?)\s+(Carried Unanimously|Carried|Defeated)\b([\s\S]{0,160}?opposed\.)?', full, re.S):
        title, result_word, tail = m.group(1), m.group(2), m.group(3)
        if 'Unanimously' in result_word:
            continue  # not a divided vote
        if not tail:
            continue  # divided result but no named dissenters nearby -> skip (conservative)
        opp = re.search(r'([^.]*?)\s+opposed\.', tail)
        against = names_to_ids(opp.group(1)) & present  # only people who were there
        if not against:
            continue
        seq += 1
        recorded = {cid: 'against' for cid in sorted(against)}
        for cid in sorted(absent):
            recorded[cid] = 'absent'
        votes.append({
            'id': f"{date}-{seq}",
            'date': date,
            'title': 'That ' + re.sub(r'\s+', ' ', title).strip(),
            'result': 'carried' if result_word == 'Carried' else 'defeated',
            'source': {'url': src if src.startswith('http') else None, 'page': page_of(m.start())},
            'attendance': sorted(present),
            'recorded': recorded,
        })
    return {'date': date, 'present': sorted(present), 'absent': sorted(absent), 'votes': votes}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: parse-minutes.py <minutes-pdf-url-or-path>'); sys.exit(2)
    print(json.dumps(parse(sys.argv[1]), indent=2, ensure_ascii=False))
