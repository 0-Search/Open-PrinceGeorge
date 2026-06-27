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
			// Only count actual rezoning / OCP *amendment bylaws*. Everything else
			// the keyword catches — meeting-extension motions, calendar changes,
			// "withhold the hearing" / "adjourn" motions, notification-area tweaks,
			// Development Variance Permits — is procedure, not a hearing, so skip it.
			var amend = v.title.match(/Amendment Bylaw No\.?\s*([0-9]+)/i);
			if (!amend) return;
			var key = 'amend-' + amend[1];
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

	// For one hearing's decisive reading, group councillors by how they voted.
	// recorded against/absent/abstain/recused are explicit; everyone else who
	// was in attendance is inferred 'for'.
	var SEG_ORDER = ['for', 'against', 'abstain', 'recused', 'absent'];
	var SEG_LABEL = { for: 'For', against: 'Against', abstain: 'Abstained', recused: 'Recused', absent: 'Absent' };

	function tallyVote(vote, order) {
		var groups = { for: [], against: [], abstain: [], recused: [], absent: [] };
		order.forEach(function(id) {
			var state = vote.recorded[id];
			if (!state) state = vote.attendance.indexOf(id) !== -1 ? 'for' : null;
			if (state && groups[state]) groups[state].push(id);
		});
		return groups;
	}

	// Pull a readable type + amendment-bylaw number out of the raw bylaw name.
	function hearingMeta(name) {
		var ocp = /Official Community Plan/i.test(name);
		var m = name.match(/Amendment Bylaw No\.?\s*(\d+)(?:,?\s*(\d{4}))?/i);
		return { type: ocp ? 'OCP amendment' : 'Rezoning', no: m ? m[1] : null, year: m && m[2] ? m[2] : null };
	}

	// One plain-English sentence per type, so a reader who has never heard the
	// word "rezoning" still understands what the vote decided.
	var TYPE_GLOSS = {
		'Rezoning': 'Rezoning — a vote on what can be built on this land',
		'OCP amendment': 'Community-plan change — updates the City’s long-term land-use map'
	};

	// Turn council's procedural verb ("carried" / "defeated") into a plain word.
	function plainResult(r) {
		r = (r || '').toLowerCase();
		if (/carr|adopt|grant|approv/.test(r)) return 'Approved';
		if (/defeat|den|reject|fail/.test(r)) return 'Rejected';
		return r || 'Decided';
	}

	// A single compact result bar per hearing. Segments are sized by vote share;
	// hovering/tapping a segment reveals the councillors in it (each a link to
	// their page). `labels` adds a plain-language description when available.
	function hearingBar(g, order, byId, labels) {
		var groups = tallyVote(g.latest, order);
		var total = order.reduce(function(n, id) {
			var s = g.latest.recorded[id] || (g.latest.attendance.indexOf(id) !== -1 ? 'for' : null);
			return n + (s ? 1 : 0);
		}, 0) || 1;

		var segs = SEG_ORDER.filter(function(k){ return groups[k].length; }).map(function(k) {
			var ids = groups[k];
			var names = ids.map(function(id) {
				var p = byId[id] || { name: id };
				return '<li><a href="councillor.html?id=' + esc(id) + '">' + esc(p.name) + '</a></li>';
			}).join('');
			return '<div class="pg-seg ' + k + '" style="flex-grow:' + ids.length + '" tabindex="0" ' +
				'aria-label="' + esc(SEG_LABEL[k]) + ': ' + ids.length + '">' +
				'<span class="pg-seg-n">' + ids.length + '</span>' +
				'<div class="pg-seg-pop"><div class="pg-seg-pop-h">' + esc(SEG_LABEL[k]) + '</div><ul>' + names + '</ul></div>' +
				'</div>';
		}).join('');

		var when = g.firstDate === g.latest.date ? esc(g.latest.date)
			: esc(g.firstDate) + ' – ' + esc(g.latest.date);
		var src = g.latest.source ? ' &middot; <a class="pg-src" href="' + esc(g.latest.source.url) + '" target="_blank" rel="noopener">minutes' +
			(g.latest.source.page ? ' p.' + esc(g.latest.source.page) : '') + ' ↗</a>' : '';

		// Headline: prefer the street address (and a plain summary if we have one);
		// fall back to the bylaw number. Either way the line below it explains, in
		// plain words, what kind of decision this was.
		var meta = hearingMeta(g.name);
		var label = labels && meta.no ? labels[meta.no] : null;
		var type = (label && label.type) || meta.type;
		var bylawRef = (meta.no ? ' &middot; Bylaw ' + esc(meta.no) : '') + (meta.year ? ' (' + esc(meta.year) + ')' : '');
		var title;
		if (label && label.address) {
			title = esc(label.address) + (label.what ? ' — ' + esc(label.what) : '');
		} else if (label && label.what) {
			title = esc(label.what);
		} else {
			title = esc(type) + bylawRef;
		}
		var ref = '<span class="pg-hbar-plain">' + esc(TYPE_GLOSS[type] || type) +
			(label && label.address ? bylawRef : '') + '</span>';

		return '<div class="pg-hbar-row">' +
			'<div class="pg-hbar-head"><span class="pg-hbar-title" title="' + esc(g.name) + '">' + title + '</span>' +
			'<span class="pg-hbar-meta">' + when + ' &middot; <strong>' + esc(plainResult(g.latest.result)) + '</strong>' + src + '</span></div>' +
			'<div class="pg-hbar-ref">' + ref + '</div>' +
			'<div class="pg-hbar">' + segs + '</div>' +
			'</div>';
	}

	function renderPast(cData, vData, labels, $root, limit) {
		var order = vData.councillorOrder;
		var byId = {};
		cData.councillors.forEach(function(p){ byId[p.id] = p; });
		labels = (labels && labels.labels) || {};

		var list = derivePastHearings(vData.votes);
		var shown = limit ? list.slice(0, limit) : list;

		var html = '<p class="pg-hbar-intro">Each row below is one council decision about a building or land-use change in Prince George ' +
			'&mdash; for example, letting someone build apartments where only houses were allowed. ' +
			'The address shows <em>where</em>; the coloured bar shows <em>how each councillor voted</em>.</p>' +
			'<p class="pg-hbar-legend">' +
			'<span class="pg-seg for"></span> For &nbsp; ' +
			'<span class="pg-seg against"></span> Against &nbsp; ' +
			'<span class="pg-seg absent"></span> Absent &nbsp; ' +
			'<span class="pg-seg abstain"></span> Abstain / recused' +
			'<br><small>Bar shows council’s final vote. Hover or tap a colour to see who &mdash; and open their page.</small></p>';
		html += '<div class="pg-hbars">' + shown.map(function(g){ return hearingBar(g, order, byId, labels); }).join('') + '</div>';
		if (limit && list.length > limit) {
			html += '<ul class="actions"><li><a href="hearings.html" class="button">Browse all ' + list.length + ' past hearings &rarr;</a></li></ul>';
		}
		$root.html(html);
	}

	// --- Boot ---------------------------------------------------------------
	$(function() {
		var $upcoming = $('#pg-hearings-upcoming');
		var $pastPreview = $('#pg-hearings-past-preview');
		var $archive = $('#pg-hearings-archive');
		if (!$upcoming.length && !$pastPreview.length && !$archive.length) return;

		var needHearings = $upcoming.length;
		var needVotes = $pastPreview.length || $archive.length;

		// Always-resolving fetch so an optional/missing file never blocks the rest.
		function optional(url) {
			var d = $.Deferred();
			$.getJSON(url).done(function(r){ d.resolve(r); }).fail(function(){ d.resolve(null); });
			return d;
		}

		var reqs = [];
		reqs.push(needHearings ? $.getJSON('data/hearings.json') : $.Deferred().resolve(null));
		reqs.push(needVotes ? $.getJSON('data/votes.json') : $.Deferred().resolve(null));
		reqs.push(needVotes ? $.getJSON('data/councillors.json') : $.Deferred().resolve(null));
		reqs.push(needVotes ? optional('data/hearing-labels.json') : $.Deferred().resolve(null));

		$.when.apply($, reqs).done(function(hRes, vRes, cRes, lRes) {
			var hData = needHearings ? (hRes[0] || hRes) : null;
			var vData = needVotes ? (vRes[0] || vRes) : null;
			var cData = needVotes ? (cRes[0] || cRes) : null;
			var labels = needVotes ? (lRes && (lRes[0] !== undefined ? lRes[0] : lRes)) : null;
			if ($upcoming.length) renderUpcoming(hData, $upcoming);
			if ($pastPreview.length && vData && cData) renderPast(cData, vData, labels, $pastPreview, 6);
			if ($archive.length && vData && cData) renderPast(cData, vData, labels, $archive, 0);
		}).fail(function() {
			var msg = '<p>Could not load hearings data. If you opened this file directly, run it from a local server.</p>';
			($upcoming.length ? $upcoming : ($archive.length ? $archive : $pastPreview)).html(msg);
		});
	});

})(jQuery);
