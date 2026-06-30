/*
 * classify.js — topic classifier for council votes (shared logic).
 * ---------------------------------------------------------------------------
 * Used both to re-categorise the existing votes.json and by the scraper when it
 * adds new votes, so classification is defined in ONE place.
 *
 * Design: classify by TOPIC ("what is this about"), not by "does it involve
 * money" — almost every motion involves money, which is why the old "finance"
 * bucket swallowed policing, parks, etc. Rules are tried IN ORDER and the first
 * match wins, so specific topics (safety, housing…) are caught before the
 * broad "budget" bucket, and bare procedural motions are caught before they
 * fall through to "other".
 *
 *   const { classify, CATEGORIES } = require('./classify');
 *   classify('That Council APPROVES four new RCMP positions...') // -> 'safety'
 */

// Order matters: first match wins. `other` has no test and is the fallback.
const CATEGORIES = [
	{ id: 'safety',       label: 'Public safety',            test: /\bRCMP\b|police|crime|offender|\bfire\b|rescue|emergency|bylaw (?:1 |service )?officer|enforcement|downtown|vibrancy|homeless|camping|encampment|shelter|safety/i },
	{ id: 'housing',      label: 'Housing & development',    test: /rezon|zoning|\bOCP\b|official community plan|variance|subdivision|development (?:permit|variance|servicing|application)|land use|covenant|temporary use permit/i },
	{ id: 'community',    label: 'Parks, culture & rec',     test: /\bpark|recreation|\barts?\b|culture|library|pool|aquatic|\btrail|festiv|\bevent|sport|museum|heritage|recognition/i },
	{ id: 'infrastructure', label: 'Roads & infrastructure', test: /\broad|traffic|snow|windrow|sidewalk|transit|parking|water|sewer|utilit|\bwaste|garbage|recycl|infrastructure|speed limit|bridge/i },
	{ id: 'budget',       label: 'Budget & taxes',           test: /\btax|budget|financial plan|\blevy|reserve|contingency|grant|sponsor|contribution|remuneration|salary|wage|procurement|audit|\bloan\b|fund|economic|advocacy|expenditure/i },
	{ id: 'procedural',   label: 'Procedural & motions',     test: /amends? the main motion|postpone|\brefers?\b|receives? for information|consultation process|adopt(?:s|ion)? (?:of )?the agenda|rises? and report|recess|reconsider|\btable[sd]?\b|delegation|notice of motion|correspondence/i },
	{ id: 'governance',   label: 'Governance & policy',      test: /code of conduct|polic(?:y|ies)|procedure|committee|appoint|terms of reference|bylaw no\.|governance|meeting (?:time|calendar|schedule)|proclam/i },
	{ id: 'other',        label: 'Other',                    test: null },
];

function classify(title) {
	const t = title || '';
	for (const c of CATEGORIES) {
		if (c.test && c.test.test(t)) return c.id;
	}
	return 'other';
}

module.exports = { classify, CATEGORIES };
