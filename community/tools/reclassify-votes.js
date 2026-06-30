#!/usr/bin/env node
/*
 * reclassify-votes.js — apply tools/classify.js to data/votes.json.
 * Rewrites every vote's `category` and replaces the `categories` list with the
 * new topic-first taxonomy. Prints a before/after summary, and flags any vote
 * whose title looks like a parsing artifact (e.g. a page header) so you can
 * clean those up separately.
 *
 *   node community/tools/reclassify-votes.js
 */

const fs = require('fs');
const path = require('path');
const { classify, CATEGORIES } = require('./classify');

const file = path.join(__dirname, '..', 'data', 'votes.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const before = {};
const after = {};
data.votes.forEach(v => {
	before[v.category] = (before[v.category] || 0) + 1;
	v.category = classify(v.title);
	after[v.category] = (after[v.category] || 0) + 1;
});

// Swap in the new category list (id + label only; the regexes stay in classify.js).
data.categories = CATEGORIES.map(({ id, label }) => ({ id, label }));

// Titles that look like a misparse (page headers leaked into the title).
const suspicious = data.votes.filter(v => /Minutes\s+[–-].*Page\s+\d+|Document Number/i.test(v.title));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

console.log('BEFORE:', before);
console.log('AFTER: ', after);
if (suspicious.length) {
	console.log(`\n⚠ ${suspicious.length} vote(s) have a title that looks like a parsing artifact — review/clean separately:`);
	suspicious.forEach(v => console.log(`   [${v.id}] ${v.title.slice(0, 70)}…`));
}
console.log('\nWrote', path.relative(process.cwd(), file));
