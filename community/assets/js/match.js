(function($) {

	function esc(s) { return $('<div>').text(s == null ? '' : s).html(); }

	// A councillor's stance on one vote: 'for' if they were present and not
	// recorded against (and not abstaining/recused), 'against' if recorded
	// against, or null if they took no clear position (absent / abstain / recused).
	function stanceOf(vote, id) {
		var rec = vote.recorded && vote.recorded[id];
		if (rec === 'against') return 'against';
		if (rec === 'abstain' || rec === 'recused' || rec === 'absent') return null;
		if (vote.attendance.indexOf(id) !== -1) return 'for';
		return null;
	}
	function opposite(side) { return side === 'for' ? 'against' : 'for'; }

	// The template hides the native radio and draws the control via
	// `input[type=radio] + label:before`, so the <input> must be a SIBLING of
	// its <label> (with matching id/for), not wrapped inside it.
	function opt(name, value, text, checked) {
		var id = name + '-' + value;
		return '<input type="radio" name="' + esc(name) + '" id="' + esc(id) + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
			'<label for="' + esc(id) + '">' + esc(text) + '</label>';
	}

	function render(quiz, votes, councillors, $root) {
		var voteById = {};
		votes.votes.forEach(function(v){ voteById[v.id] = v; });
		var byId = {};
		councillors.councillors.forEach(function(p){ byId[p.id] = p; });
		var order = votes.councillorOrder;

		// Drop any question whose vote we can't find, so the quiz never breaks.
		var qs = quiz.questions.filter(function(q){ return voteById[q.voteId]; });

		var form = qs.map(function(q, i) {
			return '<div class="pg-quiz-q">' +
				'<div class="pg-quiz-topic">' + esc(q.topic) + '</div>' +
				'<p class="pg-quiz-text">' + (i + 1) + '. ' + esc(q.text) + '</p>' +
				'<div class="pg-quiz-opts" role="group">' +
					opt(q.id, 'agree', 'Agree', false) +
					opt(q.id, 'disagree', 'Disagree', false) +
					opt(q.id, 'skip', 'Not sure', true) +
				'</div>' +
				(q.context ? '<p class="pg-quiz-ctx">' + esc(q.context) + '</p>' : '') +
				'</div>';
		}).join('');

		$root.html(
			'<form id="pg-quiz-form">' + form +
			'<ul class="actions"><li><input type="submit" class="button primary" value="See my matches"></li>' +
			'<li><input type="reset" class="button" value="Clear"></li></ul></form>' +
			'<div id="pg-quiz-results"></div>'
		);

		$root.on('submit', '#pg-quiz-form', function(e) {
			e.preventDefault();
			var answered = 0;
			var tally = {};
			order.forEach(function(id){ tally[id] = { match: 0, of: 0 }; });

			qs.forEach(function(q) {
				var ans = ($('input[name="' + q.id + '"]:checked').val()) || 'skip';
				if (ans === 'skip') return;
				answered++;
				var userSide = (ans === 'agree') ? q.agreeIs : opposite(q.agreeIs);
				var v = voteById[q.voteId];
				order.forEach(function(id) {
					var st = stanceOf(v, id);
					if (!st) return;            // no clear position → doesn't count for or against
					tally[id].of++;
					if (st === userSide) tally[id].match++;
				});
			});

			if (!answered) {
				$('#pg-quiz-results').html('<p class="pg-quiz-ctx">Answer at least one question above to see your matches.</p>');
				return;
			}

			var ranked = order.map(function(id) {
				var t = tally[id];
				var pct = t.of ? Math.round(100 * t.match / t.of) : null;
				return { id: id, name: (byId[id] || {}).name || id, role: (byId[id] || {}).role, pct: pct, match: t.match, of: t.of };
			}).filter(function(r){ return r.pct !== null; })
			  .sort(function(a, b){ return b.pct - a.pct; });

			var rows = ranked.map(function(r) {
				return '<a class="pg-match-row" href="councillor.html?id=' + esc(r.id) + '">' +
					'<span class="pg-match-name">' + esc(r.name) + '</span>' +
					'<span class="pg-match-bar"><span class="pg-match-fill" style="width:' + r.pct + '%"></span></span>' +
					'<span class="pg-match-pct">' + r.pct + '%</span>' +
					'</a>';
			}).join('');

			$('#pg-quiz-results').html(
				'<h2>Your closest matches</h2>' +
				'<p>Based on the ' + answered + ' question' + (answered === 1 ? '' : 's') + ' you answered, here is how often each councillor actually voted the way you said &mdash; on these specific motions. Tap a name to see their full record.</p>' +
				'<div class="pg-match-list">' + rows + '</div>' +
				'<p class="pg-quiz-ctx">This compares your answers to a handful of past recorded votes, not everything a councillor has ever done. It is a conversation-starter, not a scorecard.</p>'
			);
			document.getElementById('pg-quiz-results').scrollIntoView({ behavior: 'smooth' });
		});
	}

	$(function() {
		var $root = $('#pg-quiz');
		if (!$root.length) return;
		$.when(
			$.getJSON('data/quiz.json'),
			$.getJSON('data/votes.json'),
			$.getJSON('data/councillors.json')
		).done(function(q, v, c) {
			render(q[0], v[0], c[0], $root);
		}).fail(function() {
			$root.html('<p>Could not load the quiz. If you opened this file directly, run it from a local server.</p>');
		});
	});

})(jQuery);
