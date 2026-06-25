(function($) {

	var $window = $(window);

	// --- Helpers -----------------------------------------------------------
	function qs(name) {
		var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
		return m ? decodeURIComponent(m[1]) : null;
	}
	function esc(s) { return $('<div>').text(s == null ? '' : s).html(); }

	// Resolve a councillor's full candidate list from the shared race record.
	// (Council members share one race; the mayor has his own. We store the race
	//  once and attach it here, instead of duplicating the list per person.)
	function raceFor(person, data) {
		var r = data.races[person.race];
		if (!r) return null;
		var candidates = r.candidates.map(function(c) {
			return $.extend({}, c, { isThisPerson: c.name === person.name });
		});
		return { year: r.year, raceType: r.raceType, candidates: candidates };
	}

	// --- Component 1: header ------------------------------------------------
	function renderHeader(person, $root) {
		var role = person.role === 'mayor' ? 'Mayor' : 'Councillor';
		$root.html(
			'<header>' +
				'<span class="image pg-avatar">' +
					'<img src="' + esc(person.photo) + '" alt="' + esc(person.name) + '" />' +
				'</span>' +
				'<h1>' + esc(person.name) + '</h1>' +
				'<p>' + esc(role) + (person.bio ? ' &mdash; ' + esc(person.bio) : '') + '</p>' +
			'</header>'
		);
	}

	// --- Component 2: a single election bar --------------------------------
	// One bar = this person's votes, scaled against the top vote-getter in the
	// race, with a caption giving rank. Council is city-wide (at-large): there
	// are no wards, so "rank of N candidates" is the meaningful number.
	function renderBars(race, $root) {
		if (!race) { $root.empty(); return; }
		var sorted = race.candidates.slice().sort(function(a,b){ return b.votes - a.votes; });
		var me = sorted.filter(function(c){ return c.isThisPerson; })[0];
		if (!me) { $root.empty(); return; }

		var rank = sorted.indexOf(me) + 1;
		var count = sorted.length;
		var max = sorted[0].votes;
		var totalVotes = sorted.reduce(function(s,c){ return s + c.votes; }, 0);
		var widthPct = max ? Math.round((me.votes / max) * 100) : 0;       // bar scaled to top candidate
		var sharePct = totalVotes ? Math.round((me.votes / totalVotes) * 100) : 0;

		function ordinal(n){ var s=['th','st','nd','rd'], v=n%100; return n + (s[(v-20)%10] || s[v] || s[0]); }
		var status = me.elected ? 'elected' : 'not elected';
		var raceLabel = race.raceType === 'mayor'
			? 'Ran for mayor (city-wide)'
			: 'Ran for council (city-wide, top ' + sorted.filter(function(c){return c.elected;}).length + ' win)';

		$root.html(
			'<h2>' + race.year + ' election result</h2>' +
			'<div class="pg-bar">' +
				'<div class="pg-bar-label"><span>' + esc(me.name) + '</span>' +
				'<span>' + me.votes.toLocaleString() + ' of ' + totalVotes.toLocaleString() + ' votes (' + sharePct + '%)</span></div>' +
				'<div class="pg-bar-track"><span class="pg-bar-fill" style="width:' + widthPct + '%"></span></div>' +
			'</div>' +
			'<p class="pg-bar-caption">' + esc(raceLabel) + ' &mdash; finished ' +
				ordinal(rank) + ' of ' + count + ' candidates, ' + status + '. ' +
				'Bar length is relative to the top vote-getter (' + max.toLocaleString() + ' votes).</p>'
		);
	}

	// --- Component 3: vote matrix ------------------------------------------
	// Reused by overview + personal page + hearings; focusedId pins/highlights one
	// column. opts.heading / opts.intro override the default title and blurb.
	function renderMatrix(councillors, votesData, focusedId, $root, opts) {
		opts = opts || {};
		var byId = {}; councillors.forEach(function(p){ byId[p.id] = p; });

		// Column order: focused first, then default (mayor, then fixed order).
		var order = votesData.councillorOrder.slice();
		if (focusedId && order.indexOf(focusedId) !== -1) {
			order = [focusedId].concat(order.filter(function(id){ return id !== focusedId; }));
		}

		function lastName(p){ var n = (p && p.name) || ''; return n.split(' ').slice(-1)[0]; }

		function cell(vote, id) {
			var state = vote.recorded[id];
			var inferred = false;
			if (!state) {
				// in attendance but not recorded against/absent => inferred 'for'
				state = vote.attendance.indexOf(id) !== -1 ? 'for' : null;
				inferred = state === 'for';
			}
			if (!state) return '<td></td>'; // not on council / no data
			var label = { for:'For', against:'Against', absent:'Absent', abstain:'Abstain', recused:'Recused' }[state] || state;
			var title = label + (inferred ? ' (inferred from attendance − recorded dissent)' : ' (recorded in minutes)');
			var focusCls = id === focusedId ? ' pg-focus-col' : '';
			return '<td class="' + focusCls.trim() + '"><span class="pg-cell ' + state + '" title="' + esc(title) + '"></span></td>';
		}

		// Head row. Column 1 = motion name (always pinned). The focused
		// councillor is the first data column and pins right beside it.
		var head = '<tr><th class="pg-row-head">Motion</th>';
		head += order.map(function(id) {
			var focusCls = id === focusedId ? ' pg-focus-col' : '';
			return '<th class="' + focusCls.trim() + '">' + esc(lastName(byId[id])) + '</th>';
		}).join('') + '</tr>';

		// One motion row. `hidden` marks rows collapsed under "show more".
		function voteRow(v, catId, hidden) {
			var src = v.source ? '<a class="pg-src" href="' + esc(v.source.url) + '" target="_blank" rel="noopener">City minutes' + (v.source.page ? ' p.' + esc(v.source.page) : '') + ' ↗</a>' : '';
			var cls = 'pg-vote-row' + (hidden ? ' pg-extra pg-extra-' + catId : '');
			var row = '<tr class="' + cls + '"' + (hidden ? ' hidden' : '') + '>' +
				'<td class="pg-row-head"><strong title="' + esc(v.title) + '">' + esc(v.title) + '</strong>' +
				'<span class="pg-src">' + esc(v.date) + ' &middot; ' + esc(v.result) + '</span>' + src + '</td>';
			row += order.map(function(id){ return cell(v, id); }).join('');
			return row + '</tr>';
		}

		var PREVIEW = opts.noCollapse ? Infinity : 3; // newest N shown per category; rest collapsed

		// Body grouped by category, each newest-first (date descending)
		var body = '';
		votesData.categories.forEach(function(cat) {
			var rows = votesData.votes.filter(function(v){ return v.category === cat.id; });
			if (!rows.length) return;
			rows.sort(function(a, b){ return (a.date < b.date ? 1 : a.date > b.date ? -1 : 0); });

			var cid = esc(cat.id), span = order.length + 1;
			var extra = rows.length - PREVIEW;
			var showLabel = 'Show ' + extra + ' older' + (extra === 1 ? ' vote' : ' votes') + ' &darr;';

			function btnRow(pos, hidden) {
				// pos: 'top' shows the expand label (and becomes "Collapse" once open);
				//      'bottom' is the closing "Collapse" shown only while expanded.
				var label = pos === 'top' ? showLabel : 'Collapse &uarr;';
				return '<tr class="pg-toggle-row pg-toggle-' + pos + '-' + cid + '" data-cat="' + cid + '"' + (hidden ? ' hidden' : '') + '>' +
					'<td colspan="' + span + '">' +
					'<button type="button" class="pg-toggle" data-cat="' + cid + '" data-show="' + showLabel + '">' + label + '</button>' +
					'</td></tr>';
			}

			body += '<tr class="pg-cat-row"><td colspan="' + span + '"><span class="pg-cat-label">' + esc(cat.label) + '</span></td></tr>';
			rows.forEach(function(v, i) { if (i < PREVIEW) body += voteRow(v, cat.id, false); });

			if (extra > 0) body += btnRow('top', false);          // expand / collapse control
			rows.forEach(function(v, i) { if (i >= PREVIEW) body += voteRow(v, cat.id, true); });
			if (extra > 0) body += btnRow('bottom', true);        // closing collapse, hidden until open
		});

		var heading = opts.heading != null ? opts.heading : 'Voting record';
		var intro = opts.intro != null ? opts.intro : 'Contested votes only &mdash; unanimous decisions are left out. Each block is one councillor\'s vote: <strong>red = against</strong>, <strong>blue = for</strong>. A <em>for</em> vote is inferred from the attendance list minus the recorded dissent &mdash; the minutes only name who voted against or was absent. Tap a motion title to read it in full.';

		$root.html(
			(heading ? '<h2>' + heading + '</h2>' : '') +
			(intro ? '<p>' + intro + '</p>' : '') +
			'<ul class="pg-legend">' +
				'<li><span class="pg-cell for"></span>For (inferred)</li>' +
				'<li><span class="pg-cell against"></span>Against (recorded)</li>' +
				'<li><span class="pg-cell absent"></span>Absent</li>' +
				'<li><span class="pg-cell abstain"></span>Abstain / recused</li>' +
			'</ul>' +
			'<div class="pg-matrix-wrap"><table class="pg-matrix">' +
				'<thead>' + head + '</thead><tbody>' + body + '</tbody>' +
			'</table></div>'
		);

		// Pin the focus column exactly at the right edge of the name column.
		// Measured from the real rendered width so there's no seam / offset,
		// and re-measured on resize (e.g. desktop <-> mobile breakpoint).
		var $table = $root.find('table.pg-matrix');
		function syncFocusOffset() {
			var $rh = $table.find('thead .pg-row-head');
			if ($rh.length && $table.length) $table[0].style.setProperty('--focus-left', $rh[0].offsetWidth + 'px');
		}
		syncFocusOffset();
		$window.off('resize.pgmatrix load.pgmatrix').on('resize.pgmatrix load.pgmatrix', syncFocusOffset);

		// Expand / collapse a category's older votes. Top button toggles label;
		// a matching collapse button sits at the bottom while expanded.
		$table.on('click', '.pg-toggle', function() {
			var cat = $(this).data('cat');
			var $top = $table.find('.pg-toggle-top-' + cat + ' .pg-toggle');
			var expanded = $table.find('.pg-extra-' + cat + ':not([hidden])').length > 0;
			if (expanded) {
				$table.find('.pg-extra-' + cat + ', .pg-toggle-bottom-' + cat).attr('hidden', 'hidden');
				$top.html($top.data('show'));
				$table.find('.pg-toggle-top-' + cat)[0].scrollIntoView({ block: 'nearest' });
			} else {
				$table.find('.pg-extra-' + cat + ', .pg-toggle-bottom-' + cat).removeAttr('hidden');
				$top.html('Collapse &uarr;');
			}
			syncFocusOffset();
		});

		// Tap a motion title to expand/collapse its full text.
		$table.on('click', '.pg-row-head strong', function() {
			$(this).toggleClass('is-open');
		});
	}

	// Personal page: avatar + election bar + matrix focused on one councillor.
	function bootCouncillor(cData, vData) {
		var id = qs('id');
		var person = cData.councillors.filter(function(p){ return p.id === id; })[0];

		if (!person) {
			$('#pg-header').html('<header><h1>Councillor not found</h1>' +
				'<p>No councillor matches <code>?id=' + esc(id) + '</code>. ' +
				'<a href="index.html">Back to council</a>.</p></header>');
			return;
		}

		document.title = person.name + ' — Open Prince George';
		renderHeader(person, $('#pg-header'));
		renderBars(raceFor(person, cData), $('#pg-bars'));
		renderMatrix(cData.councillors, vData, person.id, $('#pg-matrix'));
	}

	// Overview page: the same matrix with no focus (mayor first, default order).
	function bootOverview(cData, vData) {
		renderMatrix(cData.councillors, vData, null, $('#pg-overview-matrix'));
	}

	// --- Boot ---------------------------------------------------------------
	$(function() {
		var $councillor = $('#pg-header');
		var $overview = $('#pg-overview-matrix');
		if (!$councillor.length && !$overview.length) return; // matrix not on this page

		$.when(
			$.getJSON('data/councillors.json'),
			$.getJSON('data/votes.json')
		).done(function(cRes, vRes) {
			var cData = cRes[0], vData = vRes[0];

			if (cData._placeholder || vData._placeholder) {
				$('#pg-placeholder').html('<p><strong>Note:</strong> these figures are placeholder data and not yet verified against official sources.</p>').show();
			}
			if ($councillor.length) bootCouncillor(cData, vData);
			if ($overview.length) bootOverview(cData, vData);
		}).fail(function() {
			var msg = '<p>Could not load voting data. If you opened this file directly, run it from a local server so the JSON files can load.</p>';
			($councillor.length ? $('#pg-header') : $overview).html(msg);
		});
	});

	// Expose the matrix renderer so hearings.js can reuse the exact same
	// red/blue vote grid for public-hearing votes.
	window.OPG = window.OPG || {};
	window.OPG.renderMatrix = renderMatrix;

})(jQuery);
