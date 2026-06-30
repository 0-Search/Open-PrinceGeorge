#!/usr/bin/env node
/*
 * validate-votes.js — data quality gate for data/votes.json
 * ---------------------------------------------------------------------------
 * Reads votes.json (and councillors.json as the source of truth for who the
 * councillors are) and checks every vote against a set of rules. It does NOT
 * change anything — it only reports.
 *
 *   ERROR   = the data is wrong and must be fixed (e.g. a vote for a councillor
 *             who isn't real, or who was marked both present AND absent).
 *   WARNING = the data is suspicious and worth a human look, but not clearly
 *             broken (e.g. a meeting where not all 9 councillors are accounted
 *             for).
 *
 * Exit code is 0 when there are no errors, and 1 when there is at least one —
 * so a scheduler like GitHub Actions turns the run RED and emails you the
 * moment something bad lands. Silence = good; red = look.
 *
 * Run it from anywhere:   node community/tools/validate-votes.js
 * Check a different file:  node community/tools/validate-votes.js path/to/votes.json
 *   (handy for testing the checker itself against a deliberately-broken file)
 */

const fs = require('fs');
const path = require('path');

// Resolve the data files relative to THIS script, so it works no matter what
// directory you run it from. An optional command-line argument lets you point
// the checker at a different votes file (used to prove the checker catches
// errors). councillors.json is always the roster source of truth.
const dataDir = path.join(__dirname, '..', 'data');
const votesPath = process.argv[2] || path.join(dataDir, 'votes.json');
const votes = JSON.parse(fs.readFileSync(votesPath, 'utf8'));
const councillors = JSON.parse(fs.readFileSync(path.join(dataDir, 'councillors.json'), 'utf8'));

// --- What "valid" means, derived from the data itself ----------------------
// The set of real councillor ids comes from councillors.json. If a vote names
// anyone outside this set, it's almost certainly a parsing typo.
const VALID_COUNCILLORS = new Set(councillors.councillors.map(p => p.id));
const VALID_CATEGORIES = new Set(votes.categories.map(c => c.id));
const VALID_RESULTS = new Set(['carried', 'defeated']);
const VALID_RECORDED = new Set(['against', 'absent', 'abstain', 'recused']);
const TODAY = new Date();

// --- Collectors -------------------------------------------------------------
const errors = [];
const warnings = [];
const err  = (id, msg) => errors.push(`[${id}] ${msg}`);
const warn = (id, msg) => warnings.push(`[${id}] ${msg}`);

// --- Top-level sanity: do the two files agree on the roster? ---------------
const orderSet = new Set(votes.councillorOrder || []);
if (orderSet.size !== VALID_COUNCILLORS.size) {
	err('meta', `councillorOrder has ${orderSet.size} ids but councillors.json has ${VALID_COUNCILLORS.size}`);
}
VALID_COUNCILLORS.forEach(id => {
	if (!orderSet.has(id)) err('meta', `councillor "${id}" is in councillors.json but missing from votes.councillorOrder`);
});

// --- Per-vote checks --------------------------------------------------------
const seenIds = new Set();

votes.votes.forEach((v, i) => {
	const id = v.id || `index ${i}`;

	// 1. id present and unique
	if (!v.id) err(id, 'missing "id"');
	else if (seenIds.has(v.id)) err(id, 'duplicate id — two votes share this id');
	seenIds.add(v.id);

	// 2. date is a real YYYY-MM-DD and not in the future (minutes are past meetings)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) {
		err(id, `date "${v.date}" is not in YYYY-MM-DD form`);
	} else {
		const d = new Date(v.date + 'T00:00:00');
		if (isNaN(d)) err(id, `date "${v.date}" is not a real calendar date`);
		else if (d > TODAY) warn(id, `date "${v.date}" is in the future`);
		// 3. convention: the id should start with its date
		if (v.id && !v.id.startsWith(v.date)) warn(id, `id does not start with its date "${v.date}"`);
	}

	// 4. category is one we know about
	if (!VALID_CATEGORIES.has(v.category)) err(id, `unknown category "${v.category}"`);

	// 5. title looks real (a very short title usually means a broken PDF parse)
	if (!v.title || typeof v.title !== 'string') err(id, 'missing "title"');
	else if (v.title.trim().length < 15) warn(id, `title is suspiciously short: "${v.title}"`);

	// 6. result is carried/defeated
	if (!VALID_RESULTS.has(v.result)) err(id, `result "${v.result}" is not carried/defeated`);

	// 7. source link + page number
	if (!v.source || typeof v.source !== 'object') {
		err(id, 'missing "source"');
	} else {
		if (!/^https?:\/\//.test(v.source.url || '')) err(id, `source.url is not a web link: "${v.source.url}"`);
		if (!Number.isInteger(v.source.page) || v.source.page < 1) warn(id, `source.page "${v.source.page}" is not a positive page number`);
	}

	// 8. attendance: a non-empty list of KNOWN councillors, no repeats
	const attendance = Array.isArray(v.attendance) ? v.attendance : null;
	if (!attendance) {
		err(id, 'missing "attendance" array');
	} else {
		const seen = new Set();
		attendance.forEach(cid => {
			if (!VALID_COUNCILLORS.has(cid)) err(id, `attendance lists unknown councillor "${cid}"`);
			if (seen.has(cid)) err(id, `councillor "${cid}" appears twice in attendance`);
			seen.add(cid);
		});
	}

	// 9 & 10. recorded positions: known councillors, known states, and consistent
	//          with attendance (you can't vote "against" if you weren't there;
	//          you can't be "absent" and present at the same time).
	const recorded = v.recorded || {};
	let hasAgainst = false;
	Object.keys(recorded).forEach(cid => {
		const state = recorded[cid];
		if (!VALID_COUNCILLORS.has(cid)) err(id, `recorded names unknown councillor "${cid}"`);
		if (!VALID_RECORDED.has(state)) err(id, `councillor "${cid}" has unknown state "${state}"`);
		if (state === 'against') hasAgainst = true;

		const present = attendance && attendance.includes(cid);
		if (state === 'absent' && present) err(id, `"${cid}" is marked absent but also listed in attendance`);
		if ((state === 'against' || state === 'abstain' || state === 'recused') && !present) {
			err(id, `"${cid}" voted "${state}" but is not in attendance`);
		}
	});

	// 11. this dataset only lists DIVIDED motions, so every vote should have at
	//     least one "against". None usually means a unanimous vote slipped in.
	if (!hasAgainst) warn(id, 'no councillor recorded "against" — should this divided-votes file contain it?');

	// 12. roster sanity: present + absent should account for all 9 councillors,
	//     with nobody counted twice.
	if (attendance) {
		const absent = Object.keys(recorded).filter(cid => recorded[cid] === 'absent');
		const overlap = absent.filter(cid => attendance.includes(cid));
		const total = attendance.length + absent.length;
		if (overlap.length === 0 && total !== VALID_COUNCILLORS.size) {
			warn(id, `${attendance.length} present + ${absent.length} absent = ${total}, expected ${VALID_COUNCILLORS.size}`);
		}
	}
});

// --- Report -----------------------------------------------------------------
console.log(`\nChecked ${votes.votes.length} votes against ${VALID_COUNCILLORS.size} councillors.`);
console.log(`Errors: ${errors.length}   Warnings: ${warnings.length}\n`);

if (warnings.length) {
	console.log('— WARNINGS (worth a look) —');
	warnings.forEach(w => console.log('  ⚠ ' + w));
	console.log('');
}
if (errors.length) {
	console.log('— ERRORS (must fix) —');
	errors.forEach(e => console.log('  ✗ ' + e));
	console.log('');
}
if (!errors.length && !warnings.length) console.log('✓ All clean.\n');

// Non-zero exit on errors so CI/schedulers can catch failures automatically.
process.exit(errors.length ? 1 : 0);
