(function($) {

	function esc(s) { return $('<div>').text(s == null ? '' : s).html(); }

	// --- Derive PAST hearings from the voting record ------------------------
	// In BC, public hearings are required for OCP amendments and for zoning
	// amendments inconsistent with the OCP. We flag votes whose titles name one
	// of those, then group the multiple readings of one bylaw into a single
	// hearing entry. This is a heuristic on the minutes, not an official list.
	var HEARING_RE = /rezon|zoning amendment|zoning bylaw|official community plan|\bocp\b|public hearing|land use/i;

	function quotedName(title) {
		var m = title.match(/[“"]([^”"]+)[”"]/); // bylaw name sits in quotes
		return m ? m[1].trim() : title.replace(/^That Council[^"“]*/i, '').trim();
	}
	function bylawKey(title) {
		var amend = title.match(/Amendment Bylaw No\.?\s*([0-9]+)/i);
		if (amend) return 'amend-' + amend[1];
		var by = title.match(/Bylaw No\.?\s*([0-9]+)/i);
		if (by) return 'bylaw-' + by[1];
		return quotedName(title).toLowerCase();
	}

	function derivePastHearings(votes) {
		var groups = {};
		votes.forEach(function(v) {
			if (!HEARING_RE.test(v.title)) return;
			var key = bylawKey(v.title);
			if (!groups[key]) groups[key] = { key: key, name: quotedName(v.title), votes: [] };
			groups[key].votes.push(v);
		});
		var list = Object.keys(groups).map(function(k) {
			var g = groups[k];
			g.votes.sort(function(a, b){ return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
			g.latest = g.votes[0];
			g.firstDate = g.votes[g.votes.length - 1].date;
			return g;
		});
		list.sort(function(a, b){ return a.latest.date < b.latest.date ? 1 : a.latest.date > b.latest.date ? -1 : 0; });
		return list;
	}

	// --- Renderers ----------------------------------------------------------
	function upcomingCard(h) {
		var online = h.online ? '<li><strong>Online:</strong> Zoom ID ' + esc(h.online.zoomMeetingId) +
			(h.online.phone ? ', or phone ' + esc(h.online.phone) + ' (press *9 to speak)' : '') + '</li>' : '';
		return '<article class="pg-hearing-card">' +
			'<div class="pg-hearing-date">' + esc(h.date) + (h.time ? ' &middot; ' + esc(h.time) : '') + '</div>' +
			'<h3>' + esc(h.title) + '</h3>' +
			(h.type ? '<p class="pg-hearing-type">' + esc(h.type) + '</p>' : '') +
			(h.plain ? '<p>' + esc(h.plain) + '</p>' : '') +
			'<ul class="pg-hearing-meta">' +
				(h.location ? '<li><strong>In person:</strong> ' + esc(h.location) + '</li>' : '') +
				online +
				(h.commentDeadline ? '<li><strong>Written comments:</strong> email cityclerk@princegeorge.ca by ' + esc(h.commentDeadline) + '</li>' : '') +
			'</ul>' +
			(h.source ? '<a class="pg-src" href="' + esc(h.source.url) + '" target="_blank" rel="noopener">' + esc(h.source.label || 'Official notice') + ' ↗</a>' : '') +
			'</article>';
	}

	function renderUpcoming(hearings, $root) {
		var up = (hearings && hearings.upcoming) || [];
		if (!up.length) {
			$root.html('<p class="pg-hearing-none">No public hearings are scheduled right now. ' +
				'The City posts notices about a week ahead &mdash; check back, or see the ' +
				'<a href="https://www.princegeorge.ca/city-hall/mayor-council/meetings-agendas-minutes" target="_blank" rel="noopener">City’s meetings page ↗</a>.</p>');
			return;
		}
		$root.html(up.map(upcomingCard).join(''));
	}

	// Render past hearings as the SAME red/blue vote matrix used elsewhere: one
	// row per hearing (its final recorded reading), 9 councillor columns showing
	// who voted for/against the rezoning or OCP change.
	function renderPast(cData, vData, $root, limit) {
		if (!window.OPG || !window.OPG.renderMatrix) {
			$root.html('<p>Voting matrix unavailable (councillor.js did not load).</p>');
			return;
		}
		var list = derivePastHearings(vData.votes);
		var shown = limit ? list.slice(0, limit) : list;

		// One synthetic vote per hearing = its latest reading, relabelled with
		// the clean bylaw name and dropped into a single "hearings" category.
		var synthVotes = shown.map(function(g) {
			return $.extend({}, g.latest, { title: g.name, category: 'hearings' });
		});
		var votesData = {
			councillorOrder: vData.councillorOrder,
			categories: [{ id: 'hearings', label: 'Public hearings' }],
			votes: synthVotes
		};

		$root.empty();
		var $matrix = $('<div></div>').appendTo($root);
		window.OPG.renderMatrix(cData.councillors, votesData, null, $matrix, {
			heading: '',
			intro: 'How every councillor voted on each rezoning / OCP change &mdash; final recorded reading, newest first. <strong>Red = against</strong>, <strong>blue = for</strong> (inferred from the attendance list minus recorded dissent). Tap a title for the full bylaw name; each links to the city minutes.',
			noCollapse: true
		});
		if (limit && list.length > limit) {
			$root.append('<ul class="actions"><li><a href="hearings.html" class="button">Browse all ' + list.length + ' past hearings &rarr;</a></li></ul>');
		}
	}

	// --- Boot ---------------------------------------------------------------
	$(function() {
		var $upcoming = $('#pg-hearings-upcoming');
		var $pastPreview = $('#pg-hearings-past-preview');
		var $archive = $('#pg-hearings-archive');
		if (!$upcoming.length && !$pastPreview.length && !$archive.length) return;

		var needHearings = $upcoming.length;
		var needVotes = $pastPreview.length || $archive.length;

		var reqs = [];
		reqs.push(needHearings ? $.getJSON('data/hearings.json') : $.Deferred().resolve(null));
		reqs.push(needVotes ? $.getJSON('data/votes.json') : $.Deferred().resolve(null));
		reqs.push(needVotes ? $.getJSON('data/councillors.json') : $.Deferred().resolve(null));

		$.when.apply($, reqs).done(function(hRes, vRes, cRes) {
			var hData = needHearings ? (hRes[0] || hRes) : null;
			var vData = needVotes ? (vRes[0] || vRes) : null;
			var cData = needVotes ? (cRes[0] || cRes) : null;
			if ($upcoming.length) renderUpcoming(hData, $upcoming);
			if ($pastPreview.length && vData && cData) renderPast(cData, vData, $pastPreview, 6);
			if ($archive.length && vData && cData) renderPast(cData, vData, $archive, 0);
		}).fail(function() {
			var msg = '<p>Could not load hearings data. If you opened this file directly, run it from a local server.</p>';
			($upcoming.length ? $upcoming : ($archive.length ? $archive : $pastPreview)).html(msg);
		});
	});

})(jQuery);
