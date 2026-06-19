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
	// Reused by overview + personal page; focusedId pins/highlights one column.
	function renderMatrix(councillors, votesData, focusedId, $root) {
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

		// Body grouped by category
		var body = '';
		votesData.categories.forEach(function(cat) {
			var rows = votesData.votes.filter(function(v){ return v.category === cat.id; });
			if (!rows.length) return;
			body += '<tr class="pg-cat-row"><td colspan="' + (order.length + 1) + '"><span class="pg-cat-label">' + esc(cat.label) + '</span></td></tr>';
			rows.forEach(function(v) {
				var src = v.source ? '<a class="pg-src" href="' + esc(v.source.url) + '" target="_blank" rel="noopener">City minutes' + (v.source.page ? ' p.' + esc(v.source.page) : '') + ' ↗</a>' : '';
				body += '<tr><td class="pg-row-head"><strong>' + esc(v.title) + '</strong>' +
					'<span class="pg-src">' + esc(v.date) + ' &middot; ' + esc(v.result) + '</span>' + src + '</td>';
				body += order.map(function(id){ return cell(v, id); }).join('');
				body += '</tr>';
			});
		});

		$root.html(
			'<h2>Voting record</h2>' +
			'<p>Contested votes only &mdash; unanimous decisions are left out. Each block is one councillor\'s vote: <strong>red = against</strong>, <strong>blue = for</strong>. A <em>for</em> vote is inferred from the attendance list minus the recorded dissent &mdash; the minutes only name who voted against or was absent.</p>' +
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
	}

	// --- Boot ---------------------------------------------------------------
	$(function() {
		var id = qs('id');
		$.when(
			$.getJSON('data/councillors.json'),
			$.getJSON('data/votes.json')
		).done(function(cRes, vRes) {
			var cData = cRes[0], vData = vRes[0];
			var person = cData.councillors.filter(function(p){ return p.id === id; })[0];

			if (!person) {
				$('#pg-header').html('<header><h1>Councillor not found</h1>' +
					'<p>No councillor matches <code>?id=' + esc(id) + '</code>. ' +
					'<a href="index.html">Back to council</a>.</p></header>');
				return;
			}

			document.title = person.name + ' — Open Prince George';
			if (cData._placeholder || vData._placeholder) {
				$('#pg-placeholder').html('<p><strong>Note:</strong> these figures are placeholder data and not yet verified against official sources.</p>').show();
			}

			renderHeader(person, $('#pg-header'));
			renderBars(raceFor(person, cData), $('#pg-bars'));
			renderMatrix(cData.councillors, vData, person.id, $('#pg-matrix'));
		}).fail(function() {
			$('#pg-header').html('<header><h1>Could not load data</h1>' +
				'<p>If you opened this file directly, run it from a local server so the JSON files can load.</p></header>');
		});
	});

})(jQuery);
