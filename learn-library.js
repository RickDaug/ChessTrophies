/* learn-library.js — Readable chess strategy articles for ChessTrophies.
   Self-contained IIFE. All content is original, written for this app.
   Exposes: window.CT_LIBRARY (array), window.CT_renderLibrary(containerEl). */
(function () {
  'use strict';
  var CT = window.CT || {};

  // ---- Original strategy articles (hand-written for ChessTrophies) ----
  var ARTICLES = [
    {
      id: 'why-center',
      cat: 'Opening',
      icon: '\u265F',
      title: 'Why the Center Wins Games',
      blurb: 'The four squares in the middle decide who attacks and who defends.',
      mins: 4,
      body: [
        { h: 'The simplest idea in chess' },
        { p: 'Imagine you are standing in the middle of a room. From there you can reach any wall in a step or two. Now stand in a corner: half your options vanish. Chess pieces feel the same way. A knight in the center touches up to eight squares; a knight in the corner touches two. The center is simply where your army can do the most work.' },
        { p: 'When players talk about "controlling the center," they mean the four squares right in the middle of the board. Owning that space lets your pieces flow to either side of the board quickly, while your opponent has to take the long way around.' },
        { h: 'Pawns plant the flag' },
        { p: 'You usually claim the center with a pawn or two on your very first moves. A pawn sitting in the middle is more than a blocker: it pushes the enemy pieces back and builds a little wall behind which your bishops and knights can develop in peace.' },
        { p: 'The mistake beginners make is treating the center like a trophy to grab and forget. It is not a one-time prize. The fight for those squares continues for the whole opening, and sometimes the player who gives up the center on purpose, only to strike back at it later, comes out ahead.' },
        { h: 'What to actually do' },
        { p: 'In your first few moves, put a pawn in the middle, then bring out a knight and a bishop so they aim at central squares. Do not move the same piece twice while pieces are still asleep at home. If you remember nothing else: every move in the opening should make your control of the middle a little stronger.' }
      ]
    },
    {
      id: 'develop-fast',
      cat: 'Opening',
      icon: '\u2659',
      title: 'Wake Your Pieces Up',
      blurb: 'A piece on its starting square is a player who never showed up.',
      mins: 4,
      body: [
        { h: 'Development is just showing up' },
        { p: 'At the start, every piece except your pawns is asleep on the back row. "Development" is the unglamorous act of waking them up and pointing them at the action. It sounds obvious, yet most games between beginners are decided by one simple fact: one player got their pieces out and the other did not.' },
        { p: 'Think of it like a race. You and your opponent each have a team to deploy. If you bring three pieces into play while your opponent moves the same bishop back and forth, you are effectively playing with three soldiers against one.' },
        { h: 'Knights before bishops, usually' },
        { p: 'A common rule of thumb is to develop knights before bishops. The reason is practical: it is usually clear where a knight belongs early, while a bishop often wants to wait and see which diagonal will matter. Rules like this are training wheels, not laws. Once you understand why they exist, you will know when to break them.' },
        { h: 'Castle early, almost always' },
        { p: 'Castling is two good moves in one: your king tucks into a safe corner and a rook leaps toward the center where it belongs. Leaving your king in the middle while you chase a pawn is the most common way good positions turn into losses. Get castled, then go to work.' },
        { p: 'A clean opening checklist: claim the center, develop a knight, develop a bishop, castle, connect your rooks. Do that and you will reach the middlegame with a healthy position more often than not.' }
      ]
    },
    {
      id: 'piece-value',
      cat: 'Fundamentals',
      icon: '\u2657',
      title: 'What Your Pieces Are Worth',
      blurb: 'Knowing the rough price tags keeps you from bad trades.',
      mins: 5,
      body: [
        { h: 'A rough shopping list' },
        { p: 'Pieces are not equal, and having a rough sense of their value stops you from making trades that quietly lose the game. The usual scale counts a pawn as one point, a knight or bishop as about three, a rook as five, and the queen as nine. The king has no number because losing it ends everything.' },
        { p: 'These numbers are a guide, not gospel. They tell you that giving up a rook for a knight is usually a bad idea, and that two minor pieces are often worth more than a single rook. But they cannot capture the whole truth of a position.' },
        { h: 'When the numbers lie' },
        { p: 'A knight stuck in the corner with nothing to do can be worth less than a pawn. A bishop raking across an open board can be worth far more than three. Context decides. A piece is valuable in proportion to what it can actually accomplish right now, not what a chart says.' },
        { p: 'The two bishops working together are a famous example. On an open board they cover squares of both colors and can dominate from a distance, which is why strong players quietly treasure "the bishop pair" even though the point count says nothing special.' },
        { h: 'The practical takeaway' },
        { p: 'Before any trade, ask a simple question: after the dust settles, whose remaining pieces are doing more? If the answer is yours, the trade is good even if the point totals look even. Material is a tool for measuring; activity is what actually wins.' }
      ]
    },
    {
      id: 'king-safety',
      cat: 'Fundamentals',
      icon: '\u2654',
      title: 'Keep Your King Out of Trouble',
      blurb: 'Most attacks succeed because the defender forgot about the king.',
      mins: 4,
      body: [
        { h: 'The one piece you cannot lose' },
        { p: 'Every other piece can be traded, sacrificed, or lost. The king cannot. That single fact should color how you think about the whole game. A position can look wonderful, but if your king is exposed, none of it matters.' },
        { h: 'The shield of pawns' },
        { p: 'After you castle, the pawns in front of your king form a little shield. Pushing those pawns forward without good reason pokes holes in that shield, and holes are exactly what an attacker is hunting for. Be slow to advance the pawns near your own king unless you have a concrete plan.' },
        { h: 'Notice when the storm is coming' },
        { p: 'Attacks rarely arrive out of nowhere. They are announced in advance: the opponent piles pieces toward your king, opens a file, or pushes a pawn to pry your shelter apart. The skill is not in defending perfectly under fire, it is in noticing the buildup early and bringing defenders home before the first punch lands.' },
        { p: 'If you sense danger, the cure is usually defenders and trades. Bring a piece back to guard, and offer to swap off the opponent\u2019s most dangerous attacker. An attack with fewer pieces is an attack that fizzles.' }
      ]
    },
    {
      id: 'tactics-eyes',
      cat: 'Tactics',
      icon: '\u26A1',
      title: 'Train Your Tactical Eyes',
      blurb: 'Tactics are patterns. The more you see, the more you spot.',
      mins: 5,
      body: [
        { h: 'Tactics are short, sharp sequences' },
        { p: 'A tactic is a forcing sequence of moves that wins material or delivers checkmate, usually because the opponent\u2019s pieces are caught off guard. Where strategy is the slow art of improving your position, tactics are the sudden blows that cash it in. Most decisive games at the club level are won by tactics, not deep plans.' },
        { h: 'The big three patterns' },
        { p: 'A fork is one piece attacking two targets at once, so your opponent can only save one. A pin freezes a piece in place because moving it would expose something more valuable behind it. A skewer is the pin\u2019s mirror image: the valuable piece is in front and must move, letting you grab what stands behind it.' },
        { p: 'These three show up again and again, in thousands of disguises. Once your eyes know the shapes, you start to feel them coming before you can even calculate the moves.' },
        { h: 'How to get good fast' },
        { p: 'There is no shortcut that beats solving puzzles. Each puzzle you solve burns a pattern into memory, and patterns are what let strong players find a winning combination in seconds. Aim for a handful every day rather than a marathon once a week. Consistency builds the eye.' },
        { p: 'When you sit down at the board, get in the habit of asking on every move: are any of my pieces, or my opponent\u2019s, undefended or lined up? Loose pieces and lined-up pieces are where tactics live.' }
      ]
    },
    {
      id: 'think-plan',
      cat: 'Strategy',
      icon: '\u{1F9E0}',
      title: 'How to Make a Plan',
      blurb: 'Strong players do not move at random. They aim at weaknesses.',
      mins: 5,
      body: [
        { h: 'Aimless moves lose slowly' },
        { p: 'Beginners often move because it is their turn. Stronger players move because a move serves a plan. The difference is not raw calculation, it is direction. Even a modest plan beats no plan, because it gives every move a job.' },
        { h: 'Find the weakness, aim at it' },
        { p: 'Good plans grow out of the position itself. Look for the weakest point in your opponent\u2019s camp: a lonely pawn that cannot be defended by another pawn, a square no enemy pawn can ever guard, an exposed king, a cramped corner. That weakness becomes your target, and your pieces organize around attacking it.' },
        { p: 'The same logic works in reverse. Look at your own camp and ask where you are vulnerable, then quietly fix it before your opponent notices. Half of strategy is improving your worst piece and shoring up your softest square.' },
        { h: 'Small improvements add up' },
        { p: 'You do not need a grand winning idea on every move. Often the best plan is simply to make your position a little better: reroute a passive knight to a better square, trade off your bad bishop, double your rooks on an open file. Stack enough small improvements and the position tips in your favor almost on its own.' }
      ]
    },
    {
      id: 'pawn-structure',
      cat: 'Strategy',
      icon: '\u2659',
      title: 'Pawns Are the Soul of Chess',
      blurb: 'Pawns move slowly and cannot retreat, so their shape lasts.',
      mins: 5,
      body: [
        { h: 'The skeleton of the position' },
        { p: 'Pawns are the only pieces that cannot move backward. Once you push one, that decision is permanent. Because of this, the arrangement of pawns, the pawn structure, forms a kind of skeleton that shapes the whole game. Pieces come and go, but the pawn skeleton lingers and quietly dictates where the action will be.' },
        { h: 'Strengths and scars' },
        { p: 'Some pawn shapes are healthy and some carry scars. A passed pawn, one with no enemy pawns able to stop it, is a long-term asset that can march to promotion. An isolated pawn, with no friendly pawns beside it, can be a weakness because no pawn can ever defend it. A doubled pawn, two of your pawns stacked on one file, often struggles to advance.' },
        { p: 'None of these are automatically good or bad. An isolated pawn cramps the enemy and grants open lines for your pieces just as often as it becomes a target. The art is knowing whether a given structure favors attack or careful defense.' },
        { h: 'Think before you push' },
        { p: 'Because pawn moves are permanent, they deserve extra thought. Before advancing a pawn, ask what squares you are giving up forever and whether you are creating a weakness you will have to babysit. A piece move can be undone next turn; a pawn move is a promise you keep for the rest of the game.' }
      ]
    },
    {
      id: 'endgame-basics',
      cat: 'Endgame',
      icon: '\u265A',
      title: 'The Endgame Mindset',
      blurb: 'When few pieces remain, the king becomes a fighter.',
      mins: 5,
      body: [
        { h: 'A different kind of game' },
        { p: 'When most pieces have been traded, the character of the game changes completely. The danger of a sudden mating attack fades, and tiny advantages, a single extra pawn, a slightly better king, become decisive. Many games that look drawn are quietly winning for the side who understands the endgame.' },
        { h: 'The king joins the army' },
        { p: 'For the whole opening and middlegame you hide your king. In the endgame you do the opposite: you march it toward the center and into the fight. With few enemy pieces left to attack it, the king becomes a strong piece in its own right, shouldering pawns forward and shepherding them to promotion.' },
        { h: 'Passed pawns and promotion' },
        { p: 'The dream of every endgame is to promote a pawn into a queen. A passed pawn, with a clear path ahead, is the seed of that dream. Endgame play often boils down to a footrace: can you escort your passed pawn home faster than your opponent can stop it, or create one of your own?' },
        { p: 'You do not need to memorize hundreds of positions to play endgames well. Master a few essentials, how a king and queen corner a lone king, how to push a passed pawn with your king in front, and you will convert far more winning positions than the opponent who only studied openings.' }
      ]
    },
    {
      id: 'mindset',
      cat: 'Mindset',
      icon: '\u{1F3AF}',
      title: 'Think Like a Calm Competitor',
      blurb: 'Half of chess is not panicking when the position gets sharp.',
      mins: 4,
      body: [
        { h: 'Blunders come from emotion, not ignorance' },
        { p: 'Most losing moves are not made because a player did not know better. They are made because the player got excited, scared, or impatient and stopped checking. Learning to stay calm and keep looking is a bigger upgrade than any opening trick.' },
        { h: 'A simple routine before every move' },
        { p: 'Build a habit: before you touch a piece, ask what your opponent is threatening. So many blunders are simply walking into a move the opponent already had ready. A two-second safety check, is anything of mine hanging, is anything about to be, prevents the majority of disasters.' },
        { h: 'Losing is the tuition' },
        { p: 'Every strong player has lost thousands of games. They got strong precisely because they treated each loss as a lesson rather than a verdict. After a defeat, find the one moment it slipped away and understand it. That single habit, reviewing your own games honestly, separates players who improve from players who just play.' },
        { p: 'Be patient with yourself. Chess rewards the player who keeps showing up, keeps solving puzzles, and keeps reviewing. Skill arrives quietly, game by game, and one day you notice you are seeing things you used to walk right past.' }
      ]
    }
  ];

  window.CT_LIBRARY = ARTICLES;

  function esc(s) {
    if (CT && typeof CT.escapeHTML === 'function') return CT.escapeHTML(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var PROGRESS_KEY = 'ct_library_read_v1';
  function loadRead() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]') || []; }
    catch (e) { return []; }
  }
  function markRead(id) {
    var r = loadRead();
    if (r.indexOf(id) === -1) { r.push(id); }
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(r)); } catch (e) {}
  }

  function articleListHTML() {
    var read = loadRead();
    var cats = [];
    ARTICLES.forEach(function (a) { if (cats.indexOf(a.cat) === -1) cats.push(a.cat); });
    var html = '<div class="lib-intro">' +
      '<div class="lib-intro-title">Read &amp; Learn</div>' +
      '<div class="lib-intro-sub">Short, plain-English lessons on how strong players actually think. No jargon, no fluff \u2014 just the ideas that win games. ' +
      esc(String(read.length)) + ' of ' + esc(String(ARTICLES.length)) + ' read.</div></div>';
    cats.forEach(function (cat) {
      html += '<div class="lib-cat">' + esc(cat) + '</div>';
      html += '<div class="lib-grid">';
      ARTICLES.filter(function (a) { return a.cat === cat; }).forEach(function (a) {
        var done = read.indexOf(a.id) !== -1;
        html += '<button class="lib-card" data-aid="' + esc(a.id) + '">' +
          '<div class="lib-card-icon">' + esc(a.icon) + '</div>' +
          '<div class="lib-card-main">' +
          '<div class="lib-card-title">' + esc(a.title) + (done ? ' <span class="lib-done">\u2713</span>' : '') + '</div>' +
          '<div class="lib-card-blurb">' + esc(a.blurb) + '</div>' +
          '<div class="lib-card-meta">' + esc(String(a.mins)) + ' min read</div>' +
          '</div></button>';
      });
      html += '</div>';
    });
    return html;
  }

  function articleHTML(a) {
    var html = '<button class="lib-back" data-libback="1">\u2039 All lessons</button>';
    html += '<article class="lib-article">';
    html += '<div class="lib-article-icon">' + esc(a.icon) + '</div>';
    html += '<h1 class="lib-article-title">' + esc(a.title) + '</h1>';
    html += '<div class="lib-article-meta">' + esc(a.cat) + ' \u00B7 ' + esc(String(a.mins)) + ' min read</div>';
    a.body.forEach(function (b) {
      if (b.h) html += '<h2 class="lib-h">' + esc(b.h) + '</h2>';
      else if (b.p) html += '<p class="lib-p">' + esc(b.p) + '</p>';
    });
    html += '<div class="lib-article-foot">You finished this lesson. Now go try the idea in a real game or a puzzle!</div>';
    html += '</article>';
    return html;
  }

  function renderLibrary(container) {
    if (!container) container = document.getElementById('library-content');
    if (!container) return;
    container.innerHTML = articleListHTML();
    container.querySelectorAll('.lib-card').forEach(function (el) {
      el.addEventListener('click', function () {
        var a = ARTICLES.filter(function (x) { return x.id === el.dataset.aid; })[0];
        if (!a) return;
        markRead(a.id);
        container.innerHTML = articleHTML(a);
        container.scrollTop = 0;
        var bk = container.querySelector('[data-libback]');
        if (bk) bk.addEventListener('click', function () { renderLibrary(container); });
      });
    });
  }

  window.CT_renderLibrary = renderLibrary;
})();
