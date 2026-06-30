#!/usr/bin/env node
/*
 * discover-meetings.js — STAGE 1 of the scraper: "Discover"
 * ---------------------------------------------------------------------------
 * Goal: find the web page for every Council meeting the City has published,
 * WITHOUT relying on the meetings page (its list is loaded dynamically and has
 * no usable links) or on guessing PDF file names (the City's naming changes
 * over time).
 *
 * The reliable source is the site's XML sitemap. It's an *index* that points to
 * sub-sitemaps, and those list every real page on the site — including one page
 * per Council meeting, e.g.
 *     /city-hall/mayor-council/meetings-agendas-minutes/regular-council-meeting-139
 * Each of those pages carries a machine-readable date and links to that
 * meeting's PDFs — which Stage 2 ("fetch & parse") will read.
 *
 * This script only DISCOVERS the meeting pages and writes the list to
 * tools/meeting-pages.json as a worklist. It downloads nothing heavy and
 * changes none of your data.
 *
 *   node community/tools/discover-meetings.js
 */

const fs = require('fs');
const path = require('path');

const SITEMAP_INDEX = 'https://www.princegeorge.ca/sitemap.xml';

// We only want meetings that actually produce the recorded votes we track:
// regular meetings, budget meetings, and special regular meetings. We exclude
// "closed" meetings (no public minutes) and committee/advisory pages.
const KEEP = /\/meetings-agendas-minutes\/(special-)?regular-council-(budget-)?meeting(-\d+)?$/i;
const SKIP = /closed|committee|advisory|cancelled/i;

// Pull every <loc>…</loc> URL out of an XML document.
function locs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
}

async function getText(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.text();
}

(async () => {
	// 1. Read the sitemap index, which lists the sub-sitemaps.
	const index = await getText(SITEMAP_INDEX);
	const subSitemaps = locs(index);
	console.log(`Sitemap index lists ${subSitemaps.length} sub-sitemaps.`);

	// 2. Read each sub-sitemap and collect all page URLs.
	let allPages = [];
	for (const sm of subSitemaps) {
		const xml = await getText(sm);
		const found = locs(xml);
		allPages = allPages.concat(found);
		console.log(`  ${sm} -> ${found.length} URLs`);
	}

	// 3. Keep only the council-meeting pages we care about, normalised to https
	//    and de-duplicated.
	const meetings = [...new Set(
		allPages
			.map(u => u.replace(/^http:/, 'https:'))
			.filter(u => KEEP.test(u) && !SKIP.test(u))
	)].sort();

	console.log(`\nFound ${meetings.length} council-meeting pages (out of ${allPages.length} total URLs).`);
	console.log('Sample:');
	meetings.slice(0, 5).forEach(u => console.log('  ' + u));

	// 4. Write the worklist for Stage 2.
	const out = path.join(__dirname, 'meeting-pages.json');
	fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), count: meetings.length, meetings }, null, 2));
	console.log(`\nWrote worklist -> ${path.relative(process.cwd(), out)}`);
})().catch(e => { console.error('Discover failed:', e.message); process.exit(1); });
