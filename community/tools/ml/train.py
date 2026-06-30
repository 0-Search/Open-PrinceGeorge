#!/usr/bin/env python3
"""
train.py — train a simple text classifier for council-vote titles.

This is the "student" in the distillation: it learns from titles that Claude
labelled by meaning (labeled.jsonl) and is tested on a held-out, human-checkable
set (gold.jsonl). We also print the keyword-rule baseline for comparison.

Model: TF-IDF (word 1–2 grams) + Logistic Regression. Light, interpretable,
ideal for a few hundred examples.

  python3 community/tools/ml/train.py
"""

import json, os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.pipeline import Pipeline

HERE = os.path.dirname(__file__)


def load(name):
    rows = [json.loads(l) for l in open(os.path.join(HERE, name), encoding='utf-8') if l.strip()]
    return [r['title'] for r in rows], [r['label'] for r in rows]

Xtr, ytr = load('labeled.jsonl')
Xte, yte = load('gold.jsonl')
print(f'train={len(Xtr)}  test(gold)={len(Xte)}')

clf = Pipeline([
    ('tfidf', TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, stop_words='english')),
    ('lr', LogisticRegression(max_iter=2000, class_weight='balanced', C=4.0)),
])
clf.fit(Xtr, ytr)
pred = clf.predict(Xte)

acc = accuracy_score(yte, pred)
print(f'\n=== distilled model on gold ===\naccuracy: {acc*100:.1f}%  ({sum(p==t for p,t in zip(pred,yte))}/{len(yte)})\n')
print(classification_report(yte, pred, zero_division=0))

# Save the trained model so it can be reused (e.g. to classify new harvested titles).
import pickle
pickle.dump(clf, open(os.path.join(HERE, 'model.pkl'), 'wb'))
print('saved model.pkl')

# A few example predictions for a sanity check.
print('\nsample predictions (pred  |  truth  |  title):')
for t, p, g in list(zip(Xte, pred, yte))[:8]:
    flag = '✓' if p == g else '✗'
    print(f'  {flag} {p:13} | {g:13} | {t[:60]}')
