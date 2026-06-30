#!/usr/bin/env node
/*
 * classify-votes.js — assign a category to a vote from its title, by keyword.
 * ---------------------------------------------------------------------------
 * Categories are few (finance / safety / housing / governance / other), so a
 * simple ordered keyword rule is enough. RULES are tried top to bottom and the
 * FIRST match wins — so order matters: the most distinctive, least-ambiguous
 * category (housing, via zoning/OCP language) goes first; anything that matches
 * nothing falls through to "other". Better to dump an unclear item in "other"
 * than to guess wrong.
 *
 * Run with no arguments to BACK-TEST it: it classifies every already-labelled
 * vote in data/votes.json and reports how often it agrees with the human label,
 * plus where it disagrees.
 *
 *   node community/tools/classify-votes.js
 */

// Each rule: [category, regex of telltale words]. Order = priority.
const RULES = [
	// housing first: zoning / OCP language is unmistakable.
	['housing',    /zoning|official community plan|\bocp\b|rezon|development variance|restrictive covenant|temporary use permit|\bland use\b|subdivision/i],
	// finance BEFORE safety, so police *budget* items (RCMP enhancement in the
	// financial plan) land in finance, the way the human labelled them. Kept
	// tight: operating-budget words only — NOT loan/financing (those are "other").
	['finance',    /budget|financial plan|operational financial|capital plan|service category|service enhancement|\bgrant|\btax(es|ation)?\b|contingency|reserve|procurement/i],
	// safety = operational policing / crime, once budget items are already taken.
	['safety',     /\brcmp\b|police|\bcrime\b|patrol|block watch|public safety|fire and rescue/i],
	['governance', /committee|\bpolicy\b|procedures|code of conduct|remuneration|advisory|public notice|council meeting (calendar|schedule|start)|bylaw services/i],
];

function classify(title) {
	const t = title || '';
	for (const [cat, re] of RULES) if (re.test(t)) return cat;
	return 'other';
}

module.exports = { classify };

// --- Back-test when run directly -------------------------------------------
if (require.main === module) {
	const path = require('path');
	const votes = require(path.join(__dirname, '..', 'data', 'votes.json')).votes;

	let agree = 0;
	const confusion = {}; // "human->guess" -> count, for the misses
	const misses = [];

	votes.forEach(v => {
		const guess = classify(v.title);
		if (guess === v.category) {
			agree++;
		} else {
			const key = `${v.category} → ${guess}`;
			confusion[key] = (confusion[key] || 0) + 1;
			misses.push({ key, title: v.title });
		}
	});

	const pct = (100 * agree / votes.length).toFixed(1);
	console.log(`\nBack-test: agreed with the human label on ${agree}/${votes.length} votes (${pct}%).\n`);
	console.log('Where it disagrees (human → keyword guess):');
	Object.entries(confusion).sort((a, b) => b[1] - a[1])
		.forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));

	// Show a few example misses so you can judge whether to tune the keywords.
	console.log('\nSample disagreements:');
	misses.slice(0, 6).forEach(m => console.log(`  [${m.key}] ${m.title.replace(/\s+/g, ' ').slice(0, 80)}`));
	console.log('');
}
