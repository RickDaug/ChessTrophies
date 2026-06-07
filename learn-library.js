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
    },
    {
      id: 'the-fork',
      cat: 'Tactics',
      icon: '♘',
      title: 'The Fork: One Move, Two Victims',
      blurb: 'Attack two things at once and your opponent can only save one.',
      mins: 5,
      body: [
        { h: 'The friendliest tactic to learn' },
        { p: 'A fork is when a single piece attacks two or more enemy targets in the same moment. Your opponent gets one move to respond, but two things are under fire, so they have to abandon one of them. It is the purest example of getting something for nothing, and it is usually the first tactic a new player learns to love.' },
        { p: 'Every piece can fork, even a humble pawn. A pawn that pushes forward and threatens two pieces sitting side by side will win one of them outright. Bishops fork along their diagonals, rooks along ranks and files, and the queen, attacking in every direction, is a forking machine. But one piece forks better than all the others.' },
        { h: 'The knight’s special talent' },
        { p: 'The knight is the king of forks, and the reason is its strange L-shaped jump. Because no other piece moves like it, a knight can attack a queen and a rook at the same time without either of them being able to attack the knight back. When a knight forks the enemy king and queen at once, it earns the nickname "the royal fork," and it wins the game on the spot.' },
        { p: 'Knights are sneaky precisely because their movement feels alien. A bishop’s threat travels in a straight line you can see; a knight’s threat hops over pieces and lands where you were not looking. That is why so many beginners hang their queen to a knight they simply did not picture.' },
        { h: 'How to spot them coming' },
        { p: 'Forks feed on two things: undefended pieces and pieces that share a line a single attacker can reach. Train yourself to notice when two enemy pieces are a knight’s-jump apart, or lined up on the same diagonal, rank, or file. Just as important, keep your own valuable pieces from sitting on those forkable patterns, especially near your king, where a check and a capture can come as one devastating move.' }
      ]
    },
    {
      id: 'pins-and-skewers',
      cat: 'Tactics',
      icon: '\u{1F4CC}',
      title: 'Pins and Skewers: Two Sides of a Coin',
      blurb: 'Line up the enemy and freeze a piece or win the one behind it.',
      mins: 5,
      body: [
        { h: 'The same trick, facing two ways' },
        { p: 'Pins and skewers both work by lining up two enemy pieces on a single straight line and attacking through them with a bishop, rook, or queen. The difference is only which piece stands in front. In a pin, the less valuable piece is in front, and it dare not move because something precious hides behind it. In a skewer, the valuable piece is in front, so when it flees, you grab whatever was sheltering behind it.' },
        { p: 'Because only the long-range pieces, bishops, rooks, and queens, can attack along a line, only they can pin or skewer. A knight or pawn can never do it. That alone is a good reason to value your bishops and rooks on open lines, where these threats live.' },
        { h: 'Absolute versus relative pins' },
        { p: 'A pin against the king is called absolute, because it is literally illegal to move the pinned piece, doing so would expose your own king to check, which the rules forbid. The pinned piece is nailed to the spot completely. A relative pin is softer: the piece in front shields a queen or rook rather than the king, so it can legally move, but doing so loses material. The opponent may sometimes accept that loss for a bigger gain, which is why relative pins reward careful calculation.' },
        { p: 'Pins are powerful because a pinned piece is a paralyzed piece. It cannot capture, cannot defend, cannot do its job. A favorite plan of strong players is to pin a defender and then pile more attackers onto whatever it was guarding, since the frozen piece can no longer help.' },
        { h: 'Using them and avoiding them' },
        { p: 'To exploit a pin, attack the pinned piece again with a pawn or another piece, it cannot run, so you simply win it. To escape a pin, you can block the line with another piece, challenge the pinning piece by attacking it, or unpin by moving the valuable piece behind to safety. And whenever you develop, take a half-second to notice if you are walking a knight or bishop into a pin in front of your own king or queen.' }
      ]
    },
    {
      id: 'discovered-attacks',
      cat: 'Tactics',
      icon: '⚔',
      title: 'Discovered Attacks and the Double Check',
      blurb: 'Move one piece out of the way and a second piece springs to life.',
      mins: 5,
      body: [
        { h: 'The ambush behind your own piece' },
        { p: 'A discovered attack happens when you move one piece out of the way to unleash an attack from a different piece standing behind it. The magic is that two things happen at once: the piece you moved can make its own threat, while the piece it uncovered makes another. Your opponent suddenly faces two problems created by a single move, and as with a fork, they can usually only solve one.' },
        { p: 'The reason this is so deadly is that the moving piece is free to do whatever it likes. It can capture, it can threaten, it can run to safety, all while the hidden piece behind it does the real damage. A discovered attack that uncovers a threat on the queen while the moving piece grabs a rook can win enormous material in one stroke.' },
        { h: 'The discovered check' },
        { p: 'When the uncovered attack is a check, the tactic becomes vicious. The opponent must answer the check, so they have no time to deal with whatever your moving piece just did. That is how a discovered check can casually capture the queen: the king is in check from the piece behind, the opponent is forced to respond to the check, and your roving piece walks away with the prize.' },
        { h: 'Double check: the most violent move in chess' },
        { p: 'There is one move no defense can blunt: the double check, where moving a piece gives check from that piece and from the one behind it at the same time. Two pieces are checking the king at once. You cannot capture both, you cannot block both, so the only legal reply is to move the king. The king must run, no matter what else is hanging on the board, which is why double check often leads straight to checkmate. When you see the chance for a double check, slow down and look hard, you may have a forced mate hiding in plain sight.' }
      ]
    },
    {
      id: 'back-rank-luft',
      cat: 'Tactics',
      icon: '♜',
      title: 'The Back Rank and the Lifesaving Luft',
      blurb: 'A tucked-in king can be mated by a rook on its own home row.',
      mins: 4,
      body: [
        { h: 'Safe can become trapped' },
        { p: 'You castle to make your king safe, and usually it works. But there is a famous trap hiding inside that safety. After castling, your king often sits on the back rank with a wall of its own pawns directly in front of it. Those pawns shield the king from above, but they also block its escape. If an enemy rook or queen ever lands on that back rank with check, the king has nowhere to step, and it is checkmate.' },
        { p: 'This is the back-rank mate, and it has ended countless games where one player was even winning on material. They were so focused on attacking that they never noticed their own king was boxed in by its loyal pawns, one rook check away from disaster.' },
        { h: 'Luft: a breath of air for your king' },
        { p: 'The cure is a small, quiet move called making luft, a German word for air. You simply push one of the pawns in front of your king up a square, usually the rook’s pawn (the one in the corner), opening a little escape hatch. Now if a rook checks along the back rank, your king has a square to flee to, and the mate evaporates. One tiny pawn move buys lasting peace of mind.' },
        { h: 'Use it as a weapon too' },
        { p: 'Back-rank weakness cuts both ways, so hunt for it in your opponent’s camp. If their king is hemmed in by its pawns and their back rank is poorly defended, you may have a winning combination: deflect or distract the lone defender of that rank, then crash in with a rook or queen for mate. Many beautiful finishes are nothing more than spotting that the enemy never made luft.' }
      ]
    },
    {
      id: 'mate-patterns',
      cat: 'Tactics',
      icon: '♛',
      title: 'Checkmate Patterns Worth Knowing',
      blurb: 'Mates come in named shapes. Learn the pictures, spot them faster.',
      mins: 6,
      body: [
        { h: 'Mates are pictures, not calculations' },
        { p: 'Beginners think checkmate is found by calculating endlessly. Strong players know better: most mates are recurring shapes you simply recognize, the way you recognize a friend’s face. Once a pattern lives in your memory, you stop calculating it and just see it. Here are a few classics worth keeping in your mind’s eye, each with its own name and personality.' },
        { h: 'The smothered mate' },
        { p: 'The smothered mate is the most elegant trap in chess. The enemy king is hemmed in on all sides by its own pieces, with no square to escape to. A lone knight delivers the final blow, and because the king is smothered by its own army, nothing can capture or block the knight. The classic version uses a stunning queen sacrifice to force the king’s own rook into the last escape square, then the knight hops in for mate. It feels like magic the first time you land it.' },
        { h: 'Anastasia, the Arabian, and the ladder' },
        { p: 'The Anastasia’s mate weaves a knight and a rook together: the knight covers the king’s escape squares while the rook delivers mate along the edge, trapping the king against the side of the board. The Arabian mate is one of the oldest known, a knight and a rook working as a team to corner a king, with the knight guarding the flight squares and the rook giving the final check from up close.' },
        { p: 'The ladder mate, sometimes called the staircase, is the friendliest to learn and a perfect first checkmate. With two rooks, or a rook and a queen, you check the king along one rank, push it back a row, then check it along the next, walking it step by step to the edge of the board like climbing down a ladder, until it runs out of rows and the game is over. Practice this one until it is automatic; it teaches you how heavy pieces cooperate.' },
        { h: 'Why naming them helps' },
        { p: 'Naming a pattern turns a vague tangle of pieces into a single idea you can summon instantly. When the shape of the position starts to resemble a smothered mate or an Anastasia, your eyes light up and you go looking for the finish. Collect these patterns the way you collect anything you love, and your tactical vision quietly doubles.' }
      ]
    },
    {
      id: 'the-opposition',
      cat: 'Endgame',
      icon: '♚',
      title: 'The Opposition: The Key to King Endings',
      blurb: 'When kings face off, the player NOT to move often holds the power.',
      mins: 5,
      body: [
        { h: 'A standoff that decides everything' },
        { p: 'In king-and-pawn endgames, the most important idea by far is something called the opposition. It describes the moment when the two kings stand facing each other with a single empty square between them, nose to nose along a file or rank. Kings can never move next to each other, so this standoff creates a strange and crucial rule: the player who does NOT have to move is the one in control. You "have the opposition" when it is your opponent’s turn and the kings are facing off, because they are forced to step aside and let your king advance.' },
        { p: 'It sounds backward that being forced to move is a disadvantage, but in the endgame it often is. With few pieces on the board, every king step matters, and the side compelled to give way is the side that loses ground. Whoever holds the opposition can shoulder the enemy king backward and clear a path for a pawn.' },
        { h: 'Why it wins and draws games' },
        { p: 'Holding the opposition is frequently the difference between promoting your last pawn and watching the game fizzle into a draw. With a pawn and a king against a lone king, the attacker must use the opposition to force the defending king out of the pawn’s path. Get the opposition at the right moment and the pawn marches to a new queen; lose it by a single tempo and the same position is a dead draw.' },
        { h: 'How to grab it' },
        { p: 'To take the opposition, aim to be the one moving your king to face the enemy king with one square between you, so that they must move next. A handy guide: when an ODD number of squares separates the kings on the file (one square for the direct opposition) and it is your opponent’s move, you already hold the opposition; when an EVEN number of squares separates them and it is your move, you can step forward to seize it. It feels abstract at first, but set up a king and pawn against a king and push them around, and within an afternoon the pattern clicks. Master this single idea and you will win endgames that you used to throw away.' }
      ]
    },
    {
      id: 'rook-endgames',
      cat: 'Endgame',
      icon: '♜',
      title: 'Rook Endgames Don’t Have to Be Scary',
      blurb: 'They are the most common endgame, and a few rules carry you far.',
      mins: 5,
      body: [
        { h: 'The endgame you will meet most' },
        { p: 'Rook endgames are the most common type of endgame there is, which is both good news and bad news. The bad news is that they are famously tricky, full of subtle drawing resources, so much so that there is an old saying that all rook endgames are drawn, half-joking and half-true. The good news is that you do not need to master every subtlety. A handful of guiding principles will steer you through the vast majority of them.' },
        { h: 'Put the rook behind the passed pawn' },
        { p: 'If you remember one rule, make it this: place your rook behind a passed pawn, whether the pawn is yours or your opponent’s. Behind your own passed pawn, the rook supports its march and gains scope with every square the pawn advances. Behind the enemy’s passed pawn, the rook restrains it and grows stronger as the pawn pushes forward into its line of fire. A rook in front of a passed pawn, by contrast, is a passive babysitter that gets more cramped with every step. This principle, attributed to the great Siegbert Tarrasch, decides a remarkable number of games.' },
        { h: 'Activity beats a pawn' },
        { p: 'In rook endgames, an active rook is worth more than you would guess from any point count, often more than an extra pawn. A rook that cuts off the enemy king, raids loose pawns from behind, or harasses from the side is doing real work, while a rook stuck on defense slowly loses. When in doubt, choose the move that makes your rook more active rather than the one that clings to material.' },
        { h: 'Keep the king busy' },
        { p: 'As in all endgames, your king must join the fight, and in rook endings it has a special job: shepherding your passed pawn and sheltering from annoying checks. When the enemy rook peppers your king with checks to stall your winning plan, the trick is to march your king toward the enemy rook, using your own pawn or pieces as a shield, until the checks run out. Learn the rook-behind-the-pawn rule, keep your rook active, and bring your king up, and rook endgames will stop being scary and start winning you points.' }
      ]
    },
    {
      id: 'opening-mistakes',
      cat: 'Opening',
      icon: '⚠',
      title: 'Opening Mistakes That Lose Fast',
      blurb: 'A few common habits can cost you the game in the first ten moves.',
      mins: 6,
      body: [
        { h: 'Don’t bring your queen out early' },
        { p: 'The queen is your strongest piece, and beginners are tempted to throw her into the action right away, hunting for quick attacks. It almost always backfires. Because the queen is so valuable, she cannot afford to be attacked, so the moment your opponent develops a knight or bishop that hits her, she has to flee. You waste move after move shuffling your queen to safety while your opponent calmly brings out their whole army with tempo, attacking your queen for free. Keep her home a little longer and develop your minor pieces first.' },
        { h: 'Don’t move the same piece twice' },
        { p: 'In the opening, every move should ideally wake up a new piece. Moving the same knight or bishop two or three times while the rest of your army sleeps is like sending one soldier to do push-ups while the others stay in bed. Each repeated move is a turn your opponent uses to develop a fresh piece, and those lost tempos pile up into a real disadvantage. Develop broadly, get everyone into the game, then start maneuvering.' },
        { h: 'Don’t ignore development and king safety' },
        { p: 'The fastest way to lose is to grab a pawn or chase a small gain while your pieces sit at home and your king lingers in the center. Open positions punish the undeveloped king mercilessly: files and diagonals fly open, and an army that is ready crashes through an army that is not. Follow the simple recipe, claim the center, develop knights and bishops, castle, and you will sidestep most opening disasters before they start.' },
        { h: 'The Scholar’s Mate and how to refute it' },
        { p: 'The most famous beginner trap is the Scholar’s Mate, a four-move checkmate where your opponent points a bishop and queen at the weak square next to your king, the one only the king itself defends, and tries to crash through for an instant mate. It looks terrifying the first time, but it is easily refuted by calm development. Simply bring out your knights to defend, and develop a piece that guards the targeted square or attacks the enterprising queen. Every move you make to repel the threat also develops a piece, so the attacker ends up with an exposed queen and nothing to show for it. Defend it once and you will never fear it again.' }
      ]
    },
    {
      id: 'blunder-check',
      cat: 'Mindset',
      icon: '\u{1F50D}',
      title: 'The Two-Second Blunder Check',
      blurb: 'One small habit stops you from hanging pieces for free.',
      mins: 4,
      body: [
        { h: 'The mistake that costs the most' },
        { p: 'Ask any coach what holds beginners back, and they will not say openings or fancy tactics. They will say blunders, simply giving away pieces for nothing. You can study brilliant strategy all you like, but if you hang your queen once a game, none of it matters. The single fastest way to gain strength is not to learn something new, it is to stop throwing pieces away. And the cure is a tiny habit that takes two seconds.' },
        { h: 'The habit: check before you commit' },
        { p: 'Here is the routine. You have chosen the move you want to play. Before you actually touch the piece, freeze for two seconds and ask three quick questions. First: if I make this move, is the piece I am moving safe where it lands? Second: does moving it leave anything else of mine undefended? Third, and most overlooked: what does my opponent get to do right after, is there a check, a capture, or a threat I am walking into? Only after those two seconds do you make the move.' },
        { h: 'Checks, captures, and threats' },
        { p: 'When you scan your opponent’s possible replies, look at forcing moves first, in this order: checks, captures, and threats. Forcing moves are the ones that take away your choices, and they are where nearly every blunder hides. Most disasters are not deep, they are a knight fork or a simple capture you would have seen instantly if you had only looked. The two-second check is just the discipline of always looking.' },
        { h: 'Boring beats brilliant' },
        { p: 'This habit is not glamorous. It will not feel like genius. But it is the closest thing to a cheat code that exists in chess improvement. The players who climb are rarely the ones with the flashiest ideas, they are the ones who quietly stopped blundering. Build the two-second check into every single move until it becomes automatic, and watch how many games you stop losing for no reason at all.' }
      ]
    },

    // ---- More openings ----
    {
      id: 'italian-vs-ruy-lopez',
      cat: 'Opening',
      icon: '♙',
      title: 'The Italian Game and the Ruy Lopez',
      blurb: 'Two classic openings that both eye the same target, with one little bishop the difference.',
      mins: 5,
      body: [
        { h: 'A Shared Beginning' },
        { p: 'Both of these famous openings start the same way. White plays 1.e4 (the king pawn two squares forward), Black answers 1...e5 (mirroring), then 2.Nf3 brings out a knight that attacks Black’s e5 pawn, and 2...Nc6 defends it. So far everyone agrees. The fork in the road is White’s third move, and it all comes down to where one bishop goes.' },
        { h: 'The Italian Game: 3.Bc4' },
        { p: 'In the Italian Game, White plays 3.Bc4, placing the light-squared bishop on a long diagonal aimed straight at f7. Why f7? Because f7 is the weakest square in Black’s camp early on — it is only guarded by the king. The Italian is friendly and direct: it develops a piece, points it at a real target, and prepares to castle quickly. Beginners love it because the plans are easy to understand.' },
        { h: 'The Ruy Lopez: 3.Bb5' },
        { p: 'In the Ruy Lopez (named after a 16th-century Spanish priest), White instead plays 3.Bb5, pressuring the knight on c6. The idea is sneaky: that knight defends the e5 pawn, so by leaning on the knight, White indirectly leans on Black’s center. The Ruy Lopez is more strategic and long-term, building small advantages rather than charging at f7.' },
        { h: 'Which Should You Play?' },
        { p: 'For a beginner, the Italian Game is the easier first friend — its aim at f7 makes every move feel purposeful. The Ruy Lopez is a wonderful next step once you enjoy slower, planning-rich positions. Both are completely sound and played at the very highest levels, so you cannot go wrong learning either.' }
      ]
    },
    {
      id: 'sicilian-for-beginners',
      cat: 'Opening',
      icon: '♟',
      title: 'The Sicilian Defence, Made Simple',
      blurb: 'The most popular reply to 1.e4, and why fighting back sideways works so well.',
      mins: 5,
      body: [
        { h: 'An Unbalanced Answer' },
        { p: 'When White opens 1.e4, the most common and most successful reply in all of chess is 1...c5 — the Sicilian Defence. Instead of copying White with 1...e5, Black pushes a pawn on the other side of the board. This small choice creates an unbalanced position where both sides have different plans, and that imbalance is exactly what makes the Sicilian so exciting.' },
        { h: 'The Big Idea: Counterattack' },
        { p: 'The Sicilian is not about defending passively. The c5 pawn controls the d4 square, contesting the center from the side rather than head-on. Black often gets a half-open c-file (a file with no Black pawn on it) and uses it to launch a counterattack on the queenside while White attacks on the kingside. It becomes a race — and Black is happy to race.' },
        { h: 'Why So Popular?' },
        { p: 'Because it plays to win, not just to draw. Many openings where Black copies White lead to balanced, equal games. The Sicilian deliberately keeps the position sharp and full of chances for both sides, which is why ambitious players from club level to world champions reach for it.' },
        { h: 'A Beginner’s Word of Caution' },
        { p: 'The Sicilian has more deep theory than almost any other opening, so you do not need to memorize it all. Focus on the ideas: control d4, develop your pieces, aim for the c-file, and stay safe by castling. If you understand the plan, you can play a perfectly good Sicilian without knowing twenty moves of memorized lines.' }
      ]
    },
    {
      id: 'gambits-pawn-for-speed',
      cat: 'Opening',
      icon: '⚡',
      title: 'Gambits: Trading a Pawn for Speed',
      blurb: 'Give up a pawn, grab the initiative — and learn why the Queen’s Gambit is a clever fake.',
      mins: 6,
      body: [
        { h: 'What Is a Gambit?' },
        { p: 'A gambit is an opening where you deliberately offer a pawn (sometimes more) early on, hoping to get something better in return: faster development, control of the center, or a dangerous attack. The word comes from an Italian wrestling term meaning to trip — you sacrifice a little material to knock your opponent off balance. Time, not pawns, becomes your currency.' },
        { h: 'The Queen’s Gambit Is Not a True Gambit' },
        { p: 'Here is a fact that surprises many players. The famous Queen’s Gambit (1.d4 d5 2.c4) is not really a gambit at all. White offers the c4 pawn, but if Black takes it with 2...dxc4, White can almost always win the pawn back later — for example by playing e3 and Bxc4. Because the pawn is usually regained, White is not truly sacrificing anything. It is a gambit in name only, a historical nickname rather than a genuine pawn offer.' },
        { h: 'A Real Gambit: The King’s Gambit' },
        { p: 'For a true sacrifice, look at the King’s Gambit: 1.e4 e5 2.f4. White offers the f-pawn, and if Black grabs it with 2...exf4, White genuinely gives up that pawn. In return White hopes to blast open the center, develop quickly, and attack Black’s king. This is a real bargain — material for activity — and it leads to wild, fun games.' },
        { h: 'Should Beginners Play Gambits?' },
        { p: 'Gambits are a fantastic way to learn the value of fast development and the initiative, since you feel firsthand what your sacrificed pawn buys. Just remember the deal: if your attack fizzles out, you are simply down a pawn. Play gambits for the lessons and the fun, and do not be discouraged if some of them backfire — that is part of learning.' }
      ]
    },
    {
      id: 'sound-repertoire-for-black',
      cat: 'Opening',
      icon: '♕',
      title: 'A Simple, Sound Repertoire for Black',
      blurb: 'Two reliable replies — one for 1.e4, one for 1.d4 — built on principles, not memory.',
      mins: 6,
      body: [
        { h: 'Why Have a Repertoire?' },
        { p: 'A repertoire is just your personal set of go-to openings. Having one means you are never surprised on move one — you know roughly what you want to do. As Black, you mainly need to prepare for the two most common first moves White can make: 1.e4 (king pawn) and 1.d4 (queen pawn). Let us pick one solid, principle-based answer for each.' },
        { h: 'Against 1.e4: Meet It Head-On' },
        { p: 'A wonderfully sound choice is the classical 1...e5. It fights for the center immediately and lets you develop naturally: knights to f6 and c6, a bishop out, then castle. The whole plan follows the golden opening rules — control the center, develop your minor pieces, and get your king safe. You do not need fancy theory; you need good habits.' },
        { h: 'Against 1.d4: A Solid Wall' },
        { p: 'Here a reliable beginner choice is 1...d5, mirroring White and staking your own claim in the center. From there, develop your knight to f6, bring your bishops to active squares, and castle. This kind of symmetrical, classical setup is rock-solid and teaches you sound structure without sharp traps to memorize.' },
        { h: 'Principles Beat Memorization' },
        { p: 'Notice that both answers rest on the same three ideas: occupy the center with a pawn, develop your knights and bishops toward the center, and castle early for king safety. If you ever forget your theory, fall back on those principles and you will almost always find a reasonable move. A repertoire built on understanding travels with you forever.' }
      ]
    },
    {
      id: 'opening-traps-to-know',
      cat: 'Opening',
      icon: '♟',
      title: 'Opening Traps Every Beginner Should Know',
      blurb: 'Spot the four-move checkmate coming — and turn the trap back on the trapper.',
      mins: 5,
      body: [
        { h: 'Why Learn Traps?' },
        { p: 'A trap is a sneaky setup that punishes a careless opponent, often very quickly. Learning the common ones serves two purposes: you avoid falling into them yourself, and you understand why they work. Do not rely on traps to win — a good opponent simply sidesteps them — but knowing them keeps you safe and sharp.' },
        { h: 'Scholar’s Mate: The Four-Move Checkmate' },
        { p: 'The classic beginner trap is Scholar’s Mate. It runs 1.e4 e5 2.Bc4 (bishop eyeing f7) 3.Qh5 (queen joins the attack, also eyeing f7) and if Black is not careful, 4.Qxf7# — the queen, protected by the bishop, captures on f7 for checkmate. The target, as so often, is that vulnerable f7 square next to Black’s king.' },
        { h: 'How to Defend It' },
        { p: 'The good news: Scholar’s Mate is easy to stop once you see it. When White brings the queen out early to h5, just develop a knight to f6 — it blocks the queen’s path and gains time by attacking her. Defending f7 with a piece, or playing a calm move like Qe7 or g6 to challenge the queen, also does the job. Early queen sorties look scary but usually just lose time once you defend correctly.' },
        { h: 'The Fried Liver Idea' },
        { p: 'A more advanced trap is the Fried Liver Attack, which can arise from the Italian Game when Black’s knight wanders to grab a pawn. At a high level, White sacrifices a knight on f7 to drag Black’s king out into the open, then hunts it down. You do not need the exact moves yet — the lesson is the same theme again: f7 is fragile, so be careful before chasing pawns near your own king.' },
        { h: 'The Real Takeaway' },
        { p: 'Every trap here points at one square, f7 (or f2 for White), because it is the soft spot beside the uncastled king. So the cure is the cure for almost everything in the opening: develop your pieces, do not bring your queen out too early, and castle to tuck your king away. Do that, and the traps simply bounce off.' }
      ]
    },

    // ---- More tactics ----
    {
      id: 'tactics-removing-the-defender',
      cat: 'Tactics',
      icon: '⚡',
      title: 'Removing the Defender',
      blurb: 'If a piece is only safe because one guard protects it, get rid of the guard.',
      mins: 5,
      body: [
        { h: 'The Big Idea' },
        { p: 'Many pieces are not safe on their own — they survive only because a single friendly piece defends them, meaning that piece could recapture if you took. Removing the defender (also called removing the guard) is the tactic of eliminating or chasing away that one protector. Once the guard is gone, the thing it was protecting falls.' },
        { h: 'How to Spot It' },
        { p: 'First, find an enemy target you would love to capture — a piece, or a key square like the one in front of the king. Ask: why can’t I just take it? Usually the answer is because something defends it. That defender is now your real target.' },
        { p: 'You can remove a defender three ways: capture it, attack it so it must run away, or block the line between it and the piece it guards. Any of these can leave the original target hanging (undefended and free to take).' },
        { h: 'A Simple Example' },
        { p: 'Suppose a knight on f6 is the only thing defending a rook on d7, and you have a bishop that can capture that knight. Play bishop takes knight. If the opponent recaptures the bishop with a pawn, the rook on d7 is no longer guarded — you win it next move. You happily traded a bishop to remove the guard and collect a rook.' },
        { h: 'A Word of Caution' },
        { p: 'Before you celebrate, check that capturing the defender does not create a bigger threat against you, and that the defender is not also pinned or busy in some other way that already helps you. Tactics reward the player who looks one move further than I took your guard.' }
      ]
    },
    {
      id: 'tactics-deflection-and-decoy',
      cat: 'Tactics',
      icon: '⚡',
      title: 'Deflection and Decoy: Misdirecting the Enemy',
      blurb: 'Drag an enemy piece off its job, or lure it onto a fatal square.',
      mins: 6,
      body: [
        { h: 'Two Cousins, One Goal' },
        { p: 'Deflection and decoy are sister tactics: both force an enemy piece to move where you want, not where it should be. Deflection pulls a piece away from an important duty — like guarding a square or another piece. Decoy lures a piece onto a specific square where it can be attacked, forked, or checkmated.' },
        { h: 'Deflection: Off the Job' },
        { p: 'Imagine a rook is the only defender of your opponent’s back rank, the row where their king hides. If you can give a check or a threat that forces that rook to abandon the back rank, you may then deliver checkmate there. You deflected the rook from its defensive duty. The usual tool is a forcing move — a check or a capture — the opponent cannot ignore.' },
        { h: 'Decoy: Come Here, Please' },
        { p: 'A decoy does the opposite: instead of pushing a piece away, it pulls a piece toward a square. A classic case is a sacrifice that drags the enemy king onto an exposed square where a knight then forks it together with the queen. The king did not want to go there — the decoy left it no choice.' },
        { h: 'Why Forcing Moves Matter' },
        { p: 'Both tactics depend on forcing moves: checks, captures, and direct threats that strictly limit the opponent’s replies. If the enemy piece could simply stay put, neither tactic would work. So when hunting for a deflection or decoy, look first at every check and capture you have — they are the levers that move enemy pieces against their will.' },
        { h: 'Telling Them Apart' },
        { p: 'A quick memory aid: deflection is go away (off duty), decoy is come here (onto a trap). In real games the same sacrifice sometimes does both at once, so do not worry about labeling it perfectly — just notice that you are steering an enemy piece to a square that helps you.' }
      ]
    },
    {
      id: 'tactics-zwischenzug-in-between-move',
      cat: 'Tactics',
      icon: '⚡',
      title: 'The Zwischenzug: A Sneaky In-Between Move',
      blurb: 'Before you recapture, slip in a more forcing move that changes everything.',
      mins: 6,
      body: [
        { h: 'What the Word Means' },
        { p: 'Zwischenzug (say it ZVISH-en-tsoog) is German for in-between move. It describes a moment in a sequence — usually a series of trades — where instead of making the move everyone expects, you insert a different, more forcing move first. After that surprise move does its damage, you often go back and finish the original sequence.' },
        { h: 'The Trap of Auto-Recapturing' },
        { p: 'Beginners almost always recapture right away: you took my bishop, I take yours back. That habit is exactly what the zwischenzug punishes. Before recapturing, ask: do I have a check or a threat that is even bigger than recapturing? Something my opponent must answer first? If yes, play that in-between move now — the recapture will usually still be available a move later.' },
        { h: 'A Quick Illustration' },
        { p: 'Say pieces have just been traded and you are supposed to recapture a knight. But you notice that instead you can give a check that also attacks the opponent’s queen. You give the check first. The opponent must respond to the check, you then win or save material thanks to the queen threat, and only after that do you recapture the knight. The in-between check earned a bonus.' },
        { h: 'How to Find Them' },
        { p: 'The key is to pause during any forced-looking exchange and scan for checks and captures that are more urgent than the obvious reply. A move only works as a zwischenzug if the opponent truly cannot ignore it — otherwise they simply deal with your in-between move and then take whatever you delayed. Forcing is everything.' }
      ]
    },
    {
      id: 'tactics-overloading-too-many-jobs',
      cat: 'Tactics',
      icon: '⚡',
      title: 'Overloading: One Piece, Too Many Jobs',
      blurb: 'When a single defender is guarding two things at once, attack both.',
      mins: 5,
      body: [
        { h: 'The Overworked Defender' },
        { p: 'An overloaded piece is one that has been given more defensive jobs than it can handle. Maybe a single knight is guarding two different squares, or a queen is both defending a back-rank mate and protecting a loose piece. As long as nothing forces the issue, it looks fine — but it is stretched thin, and that is a weakness.' },
        { h: 'Make It Choose' },
        { p: 'The way to punish an overloaded piece is to attack or capture one of the things it defends. To deal with that, the defender must let go of its other duty. Whichever job it abandons, you cash in there. The piece simply cannot be in two places at once.' },
        { h: 'A Concrete Picture' },
        { p: 'Suppose the opponent’s queen is doing two jobs: it defends a bishop and it also guards the only square that stops a back-rank checkmate. You capture the bishop. If the queen recaptures, it leaves the back rank and you deliver mate. If it ignores the bishop to stay home, you are simply up a bishop. The queen was overloaded, so you win either way.' },
        { h: 'Overloading vs. Deflection' },
        { p: 'These tactics are close relatives. Deflection forces a piece off one specific duty. Overloading recognizes that the piece had too many duties to begin with, then exploits that by attacking a second one. In practice you find overloading by asking, is any enemy piece defending two important things at once? If so, hit the cheaper one and watch the structure collapse.' }
      ]
    },
    {
      id: 'tactics-double-attack-engine',
      cat: 'Tactics',
      icon: '⚡',
      title: 'The Double Attack: The Engine Behind Tactics',
      blurb: 'Almost every combination boils down to one idea: threaten two things at once.',
      mins: 6,
      body: [
        { h: 'One Idea to Rule Them All' },
        { p: 'A double attack simply means making two threats at the same time so your opponent can only answer one. They save the first target; you take the second. Once you see this idea clearly, you realize it is hiding inside almost every tactic in chess.' },
        { h: 'The Famous Family Members' },
        { p: 'A fork is one piece attacking two enemy pieces at once — a knight hitting a king and a rook is a double attack. A discovered attack, where one piece moves out of the way to unleash an attack from the piece behind it, is also a double attack: the moving piece makes one threat while the unmasked piece makes another. Skewers and pins line up two targets along one line. Different names, same heartbeat.' },
        { h: 'Why It Works' },
        { p: 'Chess gives you one move per turn. If you create two genuine threats in a single move, your opponent’s one reply cannot cover both — unless a single move happens to defend both, so always check for that escape. When there is no such saving move, you collect material or deliver mate. That arithmetic, one move versus two threats, is the engine that powers tactics.' },
        { h: 'Training Your Eyes' },
        { p: 'To find double attacks, hunt for loose pieces — enemy pieces that are undefended or poorly defended — and look for a single move of yours that hits two of them, or hits one of them plus the king. A handy reminder many coaches repeat: loose pieces drop off. Two loose targets and one of your moves that reaches both is the recipe for a winning double attack.' },
        { h: 'Putting It Together' },
        { p: 'When you study forks, discovered attacks, deflections, and the rest, do not memorize them as unrelated tricks. See them as different costumes worn by the same idea: force the opponent to defend two things with one move. Master that single thought and the whole world of tactics starts to make sense.' }
      ]
    },

    // ---- More endgames ----
    {
      id: 'kp-vs-k-rule-of-square',
      cat: 'Endgame',
      icon: '♔',
      title: 'King and Pawn Versus King: The Rule of the Square',
      blurb: 'Learn the instant test that tells you if a lone pawn will queen or be caught.',
      mins: 5,
      body: [
        { h: 'The Simplest Winning Material' },
        { p: 'A king and one pawn against a lone king is the most basic winning attempt in chess. Sometimes the pawn marches in and becomes a queen; sometimes the defending king catches it and the game is a draw. Knowing which is which, before you move, is a real skill.' },
        { h: 'The Rule of the Square' },
        { p: 'The rule of the square lets you check, at a glance, whether a king can catch a passed pawn without help from its own king. Picture a square on the board: one side runs from the pawn to its queening square, and the square extends that same number of files sideways toward the defending king.' },
        { p: 'If it is the defending king’s move and that king is already inside the square (or can step into it), it will catch the pawn and draw. If the king is outside the square and cannot enter, the pawn promotes. One caution: a pawn still on its starting square can move two squares, so measure the square from the rank it can reach.' },
        { h: 'When the Kings Are Both Involved' },
        { p: 'If the attacking king escorts the pawn, the rule of the square no longer tells the whole story. Now the result usually turns on the opposition and whether the stronger side’s king can get in front of its pawn. As a guide: the defense draws if its king can reach the queening square or plant itself directly in front of the pawn; otherwise the attacker wins.' },
        { h: 'Practice the Habit' },
        { p: 'In your own games, whenever a passed pawn appears, draw the square in your mind first. It turns a tense calculation into a one-second judgment and stops you from chasing pawns you can never catch — or letting a winning pawn slip away.' }
      ]
    },
    {
      id: 'basic-mates-q-and-r',
      cat: 'Endgame',
      icon: '♕',
      title: 'Basic Checkmates: Queen and Rook Against a Lone King',
      blurb: 'Master the two mates every player needs, and dodge the dreaded stalemate.',
      mins: 6,
      body: [
        { h: 'Two Mates You Must Know' },
        { p: 'King and queen versus king, and king and rook versus king, are won for the stronger side every time. But the pieces cannot do it alone — your king must help. The shared idea is to herd the enemy king to the edge of the board and deliver mate there.' },
        { h: 'Building the Wall' },
        { p: 'Use your queen or rook to draw an invisible wall the enemy king cannot cross, shrinking the box it lives in. Each move, make the box smaller by a rank or file. Bring your own king up to support the final blow, because the lone piece needs the king’s help to checkmate, not just to check.' },
        { h: 'King and Queen: Beware Stalemate' },
        { p: 'The queen is so powerful that the real danger is stalemate — leaving the enemy king with no legal move while it is not in check, which is an instant draw. A safe method is to keep your queen a knight’s-move away from the enemy king as you push it back; this mirrors the king toward a corner without ever taking away its last square too early.' },
        { h: 'King and Rook: The March to the Edge' },
        { p: 'The rook is weaker, so both your king and rook must cooperate. Place your king directly opposite the enemy king with one rank between them (the opposition), then check with the rook to force the enemy king back a rank. Repeat until it reaches the edge, then deliver mate along that final rank.' },
        { h: 'Slow Is Fast' },
        { p: 'Both mates are easy once you stop rushing. Confine first, bring the king, and only then go for mate. Watch for stalemate with the queen on every move, and you will never let a winning endgame slip into a draw.' }
      ]
    },
    {
      id: 'lucena-and-philidor',
      cat: 'Endgame',
      icon: '♖',
      title: 'Lucena and Philidor: The Two Rook Endings to Memorize',
      blurb: 'One position wins, one draws — and they decide countless rook endgames.',
      mins: 6,
      body: [
        { h: 'Why These Two Names Matter' },
        { p: 'Rook endgames are the most common endgames in chess, and two classic positions sit at their heart. The Lucena position is a winning method for the side with an extra pawn; the Philidor position is a drawing method for the defender. Learn both and you will know which way countless rook endings are heading.' },
        { h: 'The Lucena Position (A Win)' },
        { p: 'In the Lucena position the stronger side has a pawn one step from promoting, with their own king sheltering on the queening square in front of the pawn. The only problem is that checks from the enemy rook keep driving the king away. The winning idea is called building a bridge.' },
        { p: 'You place your rook a few ranks up to create a shield, then walk your king out toward the enemy rook. When the checks come, your rook interposes — the bridge — blocking the check and letting the pawn promote safely. The exact squares take practice, but the idea is simply: use the rook as a screen so the king can escape the checks.' },
        { h: 'The Philidor Position (A Draw)' },
        { p: 'The Philidor position is the defender’s lifeline. The key idea is to keep your rook on your third rank (the third rank from your side), preventing the enemy king from advancing in front of its pawn. You hold that rank patiently. The moment the pawn finally advances to that rank, your rook swings to the far end of the board and gives checks from behind.' },
        { p: 'Because the enemy king has no shelter from these long-distance checks, it can never make progress, and the game is drawn. Rook on the third rank first, then checks from behind — that is the whole defense.' },
        { h: 'Know Which Side You Are' },
        { p: 'When a rook endgame with one extra pawn arises, ask whether you are the attacker aiming for Lucena or the defender aiming for Philidor. Steering toward the right one of these two positions is often the difference between a win, a draw, and a heartbreaking loss.' }
      ]
    },
    {
      id: 'passed-pawns-outside-passer',
      cat: 'Endgame',
      icon: '♙',
      title: 'Passed Pawns and the Power of the Outside Passer',
      blurb: 'A pawn no enemy pawn can stop becomes a giant as the board empties.',
      mins: 5,
      body: [
        { h: 'What Makes a Pawn Passed' },
        { p: 'A passed pawn is one with no enemy pawns ahead of it on its own file or on either neighboring file. Nothing can block it the way one pawn blocks another, so its only obstacle is the enemy pieces — and as pieces come off the board, that obstacle shrinks. In the endgame, a passed pawn is a constant threat to promote.' },
        { h: 'The Outside Passed Pawn' },
        { p: 'An outside passed pawn is a passer far away from the other pawns, usually on the opposite wing from where the main action and the kings are. Its power is decoy power: the enemy king must rush over to stop it from queening, and while that king is busy on the edge, your king feasts on the pawns it left behind.' },
        { h: 'Why It So Often Wins' },
        { p: 'A king can only be in one place. The outside passer pulls the defending king to one side of the board, then your own king mops up on the other side. This far-flung pawn does not even need to promote — it just needs to distract. That is why a single outside passed pawn often decides an otherwise equal endgame.' },
        { h: 'Creating and Using One' },
        { p: 'Look for chances to create an outside passer through pawn trades, especially when you have a pawn majority on one wing. Once you have one, push it just far enough to force the enemy king to commit, then turn your own king loose. Respect for the passed pawn is one of the surest signs of a strong endgame player.' }
      ]
    },
    {
      id: 'activate-your-king-endgame',
      cat: 'Endgame',
      icon: '♔',
      title: 'Activate Your King: Your Hidden Endgame Fighter',
      blurb: 'The piece you hid all game becomes a powerhouse once the queens come off.',
      mins: 5,
      body: [
        { h: 'A New Job for the King' },
        { p: 'In the opening and middlegame you tuck your king away behind a wall of pawns, because enemy pieces can hunt it down. But in the endgame, with most pieces traded off, those dangers fade. The king transforms from a fragile target into one of your strongest fighting pieces.' },
        { h: 'How Strong Is It?' },
        { p: 'An active endgame king is roughly as valuable as a minor piece in fighting strength. It can attack pawns, shoulder the enemy king aside, escort your own passed pawns up the board, and defend its own weaknesses. Leaving it idle in the corner in an endgame is like playing a piece down.' },
        { h: 'Centralize and Advance' },
        { p: 'The guiding rule is simple: bring your king toward the center and the action. A centralized king can reach both wings quickly, supporting pawns and contesting key squares. Often the side whose king reaches the important squares first — winning the race to be active — wins the endgame.' },
        { h: 'Make the Switch in Time' },
        { p: 'The hardest part is changing gears. Once you sense the position is simplifying into an endgame, consciously decide that your king should march forward. Players who keep their king cowering out of old habit hand a free advantage to opponents who confidently send their king into battle.' }
      ]
    },

    // ---- More strategy ----
    {
      id: 'open-files-and-seventh-rank',
      cat: 'Strategy',
      icon: '♖',
      title: 'Open Files and the Mighty Seventh Rank',
      blurb: 'Rooks crave open roads — and dream of landing on the enemy’s seventh rank.',
      mins: 5,
      body: [
        { h: 'What Is an Open File?' },
        { p: 'A file is one of the vertical columns on the board, labeled a through h. An open file is a file with no pawns on it at all — not yours and not your opponent’s. A half-open file has no pawns of your own, but still has an enemy pawn somewhere on it.' },
        { p: 'Open files matter because rooks move in straight lines. A rook stuck behind its own pawns sees nothing. Place that same rook on an open file and it suddenly controls the whole column, ready to charge deep into enemy territory.' },
        { h: 'Grab the File First' },
        { p: 'When a file opens up, both players usually want it. The side that puts a rook there first — and backs it up with a second rook behind the first (called doubling rooks) — normally wins control. Whoever owns the open file owns a highway into the opponent’s position.' },
        { h: 'Why the Seventh Rank Is Gold' },
        { p: 'A rank is a horizontal row. Your seventh rank is your opponent’s second rank — the row where their pawns started the game. A rook that reaches the seventh rank attacks those pawns from the side, where they cannot defend each other, and traps the enemy king on the back row.' },
        { p: 'This rook is often called a pig by strong players because it greedily gobbles undefended pawns. Two rooks on the seventh rank can be devastating, raking the enemy’s base and frequently forcing checkmate or winning material.' },
        { h: 'How to Make It Happen' },
        { p: 'Aim to trade off the pawns blocking a file so it opens for your rooks. Look for half-open files created when you capture toward the center — they point your rook straight at an enemy pawn you can pressure. Then maneuver a rook to the seventh rank, ideally where it also cuts off the enemy king.' }
      ]
    },
    {
      id: 'good-knight-bad-bishop',
      cat: 'Strategy',
      icon: '♘',
      title: 'Good Knight, Bad Bishop',
      blurb: 'A bishop boxed in by its own pawns can be weaker than a well-placed knight.',
      mins: 6,
      body: [
        { h: 'Bishops and Their Color' },
        { p: 'Each bishop travels only on squares of one color — a light-squared bishop never touches a dark square, and the reverse for the dark-squared bishop. A bishop is happiest on long, clear diagonals where it can reach across the whole board.' },
        { h: 'What Makes a Bishop Bad' },
        { p: 'A bad bishop is one whose own pawns sit on the same color squares it travels on. Those pawns block its diagonals, so it can barely move. It ends up defending pawns instead of attacking, peering at its own roadblocks like a prisoner behind bars.' },
        { p: 'Crucially, a bishop is not bad just because it is hemmed in for a moment. It is bad when your fixed pawn chain permanently locks it in. If you can free those pawns or trade the bishop off, the problem disappears.' },
        { h: 'Why a Knight Can Be Better' },
        { p: 'Knights do not care about open diagonals — they hop. In a closed position full of locked pawns, a nimble knight can route to strong squares while the bad bishop sits useless. A good knight versus bad bishop imbalance is one of the most reliable long-term edges in chess.' },
        { h: 'Using or Avoiding the Imbalance' },
        { p: 'If you have the good knight, keep the position closed so the bishop stays buried, and steer your knight toward a secure square in the enemy camp. If you are saddled with the bad bishop, try to trade it for an enemy piece, or push the pawns that block it onto the opposite color.' },
        { p: 'A simple guideline: place your pawns on the opposite color of your own bishop. That keeps your diagonals open for the bishop and leaves the other color squares guarded by the bishop itself.' }
      ]
    },
    {
      id: 'knight-outposts',
      cat: 'Strategy',
      icon: '♞',
      title: 'Outposts: Where a Knight Becomes a Monster',
      blurb: 'Plant a knight on a square no enemy pawn can hit, and it dominates the board.',
      mins: 5,
      body: [
        { h: 'What Is an Outpost?' },
        { p: 'An outpost is a square deep in your opponent’s half that their pawns can no longer attack — because the pawns that would have guarded it are gone or have already moved past. Ideally it is also a square you can defend, usually with one of your own pawns.' },
        { p: 'Because no enemy pawn can ever challenge it, a piece parked on an outpost cannot be cheaply chased away. The opponent must spend a whole piece to remove it, and trading a piece for your outposted knight often just hands you another lasting advantage.' },
        { h: 'Why Knights Love Outposts' },
        { p: 'A knight reaches its full power from a stable, advanced square in the center or near the enemy king. From an outpost on, say, the fifth or sixth rank, a single knight can attack several key squares and pieces at once, cramping the whole enemy position.' },
        { h: 'How Outposts Are Created' },
        { p: 'Outposts usually appear next to enemy pawn weaknesses. When an opponent has a backward pawn or an isolated pawn, the square in front of it can become a permanent home for your knight, since no neighboring pawn exists to drive the knight off.' },
        { h: 'Putting It to Work' },
        { p: 'Spot the holes in the enemy camp — advanced squares their pawns can never cover — then route a knight there step by step and support it with a pawn. Once your knight is anchored, build your plans around it; it becomes the cornerstone of your attack.' }
      ]
    },
    {
      id: 'space-advantage',
      cat: 'Strategy',
      icon: '♗',
      title: 'Space Advantage: Room to Maneuver',
      blurb: 'More space gives your pieces freedom — but overextend and it can crack.',
      mins: 6,
      body: [
        { h: 'What Space Means' },
        { p: 'Space is simply the amount of the board your pawns control. When your pawns are pushed further up the board than your opponent’s, you control more squares, and your pieces have more safe places to stand and travel through. The opponent gets squeezed into a smaller, more cramped zone.' },
        { h: 'Why Space Helps' },
        { p: 'With more room, you can shift pieces from one side of the board to the other faster than your opponent can. A cramped defender often has pieces tripping over each other, unable to coordinate. Space lets you maneuver freely and switch your attack to wherever the enemy is weakest.' },
        { p: 'A classic plan with a space advantage is to avoid trading pieces. The cramped side wants exchanges to get breathing room, so keeping pieces on the board keeps them uncomfortable.' },
        { h: 'The Risk of Overextension' },
        { p: 'Space comes from advanced pawns — but a pawn that moves forward can never move back. Push too far, too fast, and those pawns can become overextended: stretched out and hard to defend. The opponent may strike at the base of your pawn chain and turn your space into a collection of weaknesses.' },
        { h: 'Balancing the Two' },
        { p: 'Gain space when you can support it with pieces, and make sure your gains do not leave weak squares behind your pawns. Think of space as territory you must be able to hold — grabbing land you cannot defend simply invites a counterattack.' }
      ]
    },
    {
      id: 'weak-squares-weak-pawns',
      cat: 'Strategy',
      icon: '♟',
      title: 'Weak Squares and Weak Pawns',
      blurb: 'Isolated, doubled, and backward pawns become targets — learn to spot them.',
      mins: 6,
      body: [
        { h: 'What Makes a Pawn Weak' },
        { p: 'A pawn is weak when it cannot be defended by another pawn and must instead be guarded by your pieces. Pawns are best at defending each other in chains; a pawn cut off from that support becomes a long-term target your opponent can pile up against.' },
        { h: 'The Isolated Pawn' },
        { p: 'An isolated pawn has no friendly pawns on either of the files next to it. Because no pawn can ever defend it, it must be protected by pieces, and the square directly in front of it makes a perfect outpost for the enemy. Note that an isolated pawn can still be strong in the middlegame if it grants you active, well-placed pieces.' },
        { h: 'Doubled Pawns' },
        { p: 'Doubled pawns are two of your own pawns stacked on the same file, one in front of the other. They cannot defend each other, the rear pawn is often hard to advance, and together they control fewer squares than two pawns side by side would. They do, however, open a half-open file for your rook as compensation.' },
        { h: 'The Backward Pawn' },
        { p: 'A backward pawn has fallen behind the pawns next to it and can no longer be safely pushed forward, because an enemy pawn or piece guards the square ahead of it. It typically sits on a half-open file, where enemy rooks can stack up and hammer it, while the square in front becomes another enemy outpost.' },
        { h: 'Targeting and Avoiding Weaknesses' },
        { p: 'To attack a weak pawn, fix it in place so it cannot advance, then attack it with more pieces than can defend it — and occupy the weak square in front of it with a knight. To avoid weaknesses of your own, keep your pawns connected and think twice before making a pawn move you can never take back.' }
      ]
    },

    // ---- Improvement & more fundamentals ----
    {
      id: 'beginner-study-plan',
      cat: 'Improvement',
      icon: '♘',
      title: 'A Simple Study Plan That Actually Works',
      blurb: 'Skip the chaos: a daily routine of tactics, reviews, and a few endgames.',
      mins: 6,
      body: [
        { h: 'Stop Collecting, Start Doing' },
        { p: 'Most beginners study by watching random videos and feeling busy. Real improvement comes from a small routine you repeat. You do not need fancy tools, just twenty to thirty minutes most days and a willingness to look at your own mistakes.' },
        { h: 'Tactics Every Day' },
        { p: 'Spend ten to fifteen minutes a day solving tactics. Tactics are the short forced sequences that win material or deliver checkmate, and they decide the vast majority of games between beginners. Daily reps train your eyes to spot forks, pins, and loose pieces automatically.' },
        { h: 'Review Your Own Losses' },
        { p: 'After a loss, play through the game once and find the single move where things went wrong. Ask: did I hang a piece, miss a threat, or have no plan? You learn far more from one honest look at your own game than from an hour of someone else’s.' },
        { h: 'Learn a Few Endgames' },
        { p: 'Memorize how to checkmate with king and queen, then king and rook, then how to push a passed pawn to promotion. These come up constantly and turn drawn or lost positions into wins. A handful of endgame skills pays off in real points.' },
        { h: 'Do Not Memorize Openings' },
        { p: 'Avoid memorizing long opening lines. Instead learn the principles: control the center, develop your knights and bishops, and castle your king to safety. Understanding why beats memorizing what, because opponents rarely play the moves in the book anyway.' }
      ]
    },
    {
      id: 'clock-management-basics',
      cat: 'Improvement',
      icon: '♘',
      title: 'Beat the Clock, Not Just the Board',
      blurb: 'Avoid time trouble by knowing when to think hard and when to just move.',
      mins: 5,
      body: [
        { h: 'Time Is a Resource' },
        { p: 'Your clock is just as real as your pieces. Many beginners lose winning positions simply because they run out of time and start blundering in a panic. Treating your time as something to spend wisely is one of the fastest ways to gain rating.' },
        { h: 'Move Quickly When It Is Easy' },
        { p: 'In familiar opening positions, obvious recaptures, and forced moves where you have only one sensible reply, play fast. There is no prize for thinking three minutes about a move you were always going to make. Bank that time for harder moments.' },
        { h: 'Think Hard at Turning Points' },
        { p: 'Spend your time where the position changes character: before a capture or trade, when your opponent makes a threat, or when you must choose a plan. These critical moments deserve a real think, because a single mistake here can decide the game.' },
        { h: 'Watch for Time Trouble' },
        { p: 'Glance at your clock regularly, not just your opponent’s. A good habit is to check after every few moves. If you fall behind on time, deliberately speed up on quiet moves so you keep a cushion for the sharp positions still to come.' },
        { h: 'Always Run a Quick Check' },
        { p: 'Even when moving fast, take one second to ask whether your move leaves a piece hanging or walks into a check. A two-second safety glance prevents the kind of one-move disaster that no amount of clock time can undo.' }
      ]
    },
    {
      id: 'learn-from-losses',
      cat: 'Improvement',
      icon: '♘',
      title: 'Turn Every Loss Into a Lesson',
      blurb: 'Your defeats are free coaching once you learn to read them.',
      mins: 6,
      body: [
        { h: 'Losses Are Data' },
        { p: 'A loss stings, but it is also the clearest signal of what you need to fix. Strong players are not people who never lose; they are people who learn quickly from losing. Treat each defeat as a message about your weakest habit.' },
        { h: 'Find the Blunder' },
        { p: 'Replay the game and look for the moment things swung against you, the move where you went from fine to lost. Usually it is one specific mistake: a hung piece, a missed capture, or a threat you did not see. Name it out loud.' },
        { h: 'Ask Why You Missed It' },
        { p: 'Once you find the blunder, dig into the cause. Were you moving too fast? Did you only look at your own plan and ignore your opponent’s threat? Understanding the reason behind the mistake is what stops you from repeating it.' },
        { h: 'Spot Your Patterns' },
        { p: 'Review several losses together and you will notice the same mistakes appearing again and again, maybe you always hang back-rank pieces, or rush in the opening. These recurring patterns are your real opponents. Fixing one pattern can lift many games at once.' },
        { h: 'Keep It Short and Honest' },
        { p: 'You do not need a deep engine analysis of every move. A five-minute, honest look that finds your one big mistake is more useful than a long study you never finish. Consistency beats depth when it comes to reviewing your games.' }
      ]
    },
    {
      id: 'reading-chess-notation',
      cat: 'Fundamentals',
      icon: '♘',
      title: 'How to Read and Write Chess Moves',
      blurb: 'Crack the code of algebraic notation and follow any game ever played.',
      mins: 7,
      body: [
        { h: 'The Board Is a Grid' },
        { p: 'Every square has a name made of a letter and a number. The columns, called files, are lettered a through h from left to right from White’s side. The rows, called ranks, are numbered 1 through 8 starting from White’s side. So the square e4 means file e, rank 4.' },
        { h: 'Naming the Pieces' },
        { p: 'Each piece has a capital letter: K for king, Q for queen, R for rook, B for bishop, and N for knight (N is used so it is not confused with the king). Pawns have no letter at all. A move is written as the piece letter plus the destination square, so Nf3 means a knight moves to f3, and e4 means a pawn moves to e4.' },
        { h: 'Captures, Check, and Mate' },
        { p: 'An x marks a capture: Bxe5 means a bishop captures whatever sits on e5. When a pawn captures, you write its starting file first, like exd5. A plus sign after a move means check, as in Qh5+. A hash mark means checkmate, the end of the game, as in Qxf7#.' },
        { h: 'Castling and Promotion' },
        { p: 'Castling has its own symbols: O-O means castling kingside (the short side), and O-O-O means castling queenside (the long side), written with the capital letter O joined by hyphens. When a pawn reaches the far end and promotes, you write the new piece with an equals sign, such as e8=Q for a pawn reaching e8 and becoming a queen.' },
        { h: 'A Few Extra Marks' },
        { p: 'En passant, the special pawn capture, is sometimes noted with e.p. after the move, as in exd6 e.p. If two identical pieces could reach the same square, you add the starting file or rank to clarify, like Nbd2 or R1e2. With these symbols you can read or record any game move by move.' }
      ]
    },
    {
      id: 'three-phases-of-the-game',
      cat: 'Fundamentals',
      icon: '♘',
      title: 'The Three Phases of a Chess Game',
      blurb: 'Opening, middlegame, endgame: know your job in each stage.',
      mins: 6,
      body: [
        { h: 'Every Game Has Three Acts' },
        { p: 'A chess game naturally flows through three phases: the opening, the middlegame, and the endgame. Each has a different goal, and knowing what you are supposed to be doing in each one keeps you from drifting without a plan.' },
        { h: 'The Opening: Get Ready' },
        { p: 'The opening is the first handful of moves, and your job is setup. Fight for the center with your pawns, develop your knights and bishops off the back rank, and castle to tuck your king into safety. Think of it as bringing your whole team onto the field before the real fight.' },
        { h: 'The Middlegame: The Real Fight' },
        { p: 'Once your pieces are developed, the middlegame begins, and this is where plans and tactics collide. You look for ways to attack weak points, win material with tactics like forks and pins, or build pressure against the enemy king. Always check your opponent’s threats before pushing your own.' },
        { h: 'The Endgame: Fewer Pieces, Higher Stakes' },
        { p: 'When most pieces have been traded off, you reach the endgame. Now the king becomes a fighting piece and should march toward the center, and passed pawns racing to promote often decide the result. Precise technique matters more than flashy attacks here.' },
        { h: 'Phases Blend Together' },
        { p: 'These phases do not have hard borders; one melts into the next. The lesson is to keep asking what the position needs right now, develop and get safe early, fight with purpose in the middle, and convert carefully at the end.' }
      ]
    },

    // ---- Checkers / Draughts ----
    // New 'Checkers' category. Articles are original and beginner-friendly,
    // matching the existing article shape { id, cat, icon, title, blurb, mins, body[] }.
    {
      id: 'ck_what_is_checkers',
      cat: 'Checkers',
      icon: '⛂',
      title: 'What Is Checkers / Draughts?',
      blurb: 'A whole family of games played on dark squares, with men that grow into kings.',
      mins: 4,
      body: [
        { h: 'One game, many names' },
        { p: 'Checkers, known as draughts in much of the world, is not a single game but a family of closely related games. They all share the same heart: two players, round pieces, a checkered board, and the simple goal of capturing or trapping every enemy piece. The differences between versions come down to the size of the board and a few rules about how pieces move and jump.' },
        { h: 'Only the dark squares' },
        { p: 'Although the board is checkered in two colors, all the action happens on squares of just one color, traditionally the dark ones. Pieces sit only on dark squares and move only diagonally, so half the board is never used at all. This is why a checkers board can look identical to a chess board yet play in a completely different way.' },
        { h: 'Men and kings' },
        { p: 'You start with ordinary pieces called men. A man is limited: it can only step and capture in certain directions. When a man reaches the far side of the board, it is crowned and becomes a king, usually shown by stacking a second piece on top. A king is more powerful, able to move and capture in more directions, and getting one is often the turning point of a game.' },
        { h: 'How you win' },
        { p: 'The goal is the same across every version: leave your opponent with nothing to do. You win by capturing all of their pieces, or by blocking them so completely that they have no legal move on their turn. If neither side can make progress, the game is a draw.' }
      ]
    },
    {
      id: 'ck_how_to_play_8x8',
      cat: 'Checkers',
      icon: '⛂',
      title: 'How to Play: 8×8 American Checkers (ACF)',
      blurb: 'The classic version on a small board, with forward-only men and capturing that you cannot skip.',
      mins: 5,
      body: [
        { h: 'The board and setup' },
        { p: 'American checkers, governed by the American Checker Federation, is played on a standard 8×8 board using only the dark squares. Each player starts with twelve men lined up on the three rows nearest to them. The remaining two empty rows in the middle are the no-mans-land where the first captures usually happen.' },
        { h: 'How men move and capture' },
        { p: 'An ordinary man moves one square diagonally forward, toward the opponent. To capture, it jumps diagonally forward over an adjacent enemy piece into the empty square just beyond, removing the jumped piece. In this version men capture forward only; they can never jump backward. If your jump lands you next to another enemy piece you can leap again, chaining several captures in a single turn.' },
        { h: 'Capturing is mandatory' },
        { p: 'You are not allowed to ignore a capture. If a jump is available on your turn, you must take it. When more than one capturing move exists, you may choose any of them; this version does not force you to pick the jump that captures the most pieces. That single freedom is one of the things that sets it apart from the international game.' },
        { h: 'Kings and how to win' },
        { p: 'When a man reaches the far back row, it is crowned a king. A king may move and capture diagonally both forward and backward, which makes it far more useful, but it still only steps one square at a time; it is not a flying king. You win by capturing all of your opponent’s pieces or by leaving them with no legal move on their turn.' }
      ]
    },
    {
      id: 'ck_how_to_play_10x10',
      cat: 'Checkers',
      icon: '⛂',
      title: 'How to Play: 10×10 International Draughts (FMJD)',
      blurb: 'The big-board version with backward captures, flying kings, and a must-take-the-most rule.',
      mins: 6,
      body: [
        { h: 'A bigger board, more pieces' },
        { p: 'International draughts, overseen by the world body known as the FMJD, is played on a larger 10×10 board, again on the dark squares only. Each side begins with twenty men arranged on the four rows closest to them. The bigger board and extra pieces make for longer, deeper games with more room to maneuver.' },
        { h: 'Men capture in every direction' },
        { p: 'An ordinary man still moves one square diagonally forward. But here is a key difference: when capturing, a man may jump an enemy piece either forward or backward. This backward capture for ordinary men means threats can come from any diagonal, and a piece that looks safe behind you may not be safe at all.' },
        { h: 'The maximum-capture rule' },
        { p: 'Capturing is mandatory, and this version goes further: you must make the capturing move that takes the greatest number of pieces. If one jump sequence wins three pieces and another wins two, you are required to play the one that wins three. You count the whole chain, not just the first leap, before deciding which capture is forced.' },
        { h: 'Flying kings and winning' },
        { p: 'When a man reaches the far back row it becomes a king, and here the king is a flying king. It glides any distance along a clear diagonal in one move, and when capturing it can jump an enemy piece from far away and land on any empty square beyond it. A single flying king can sweep across the whole board, which makes promotion enormously powerful. As always, you win by capturing every enemy piece or leaving your opponent with no legal move.' }
      ]
    },
    {
      id: 'ck_ruleset_differences',
      cat: 'Checkers',
      icon: '⚖',
      title: 'Rule-Set Differences: ACF vs FMJD / WCDF',
      blurb: 'Backward captures, flying kings, board size, and the must-jump-the-most rule, side by side.',
      mins: 6,
      body: [
        { h: 'Why the rules differ' },
        { p: 'Different traditions grew up around different boards, so several official rule sets exist. The two most common reference points are American or English-style checkers, used by bodies such as the ACF and the WCDF, and international draughts under the FMJD. Knowing which version you are playing matters, because the same move can be legal in one and impossible in the other.' },
        { h: 'Do men capture backward?' },
        { p: 'This is the single biggest difference for beginners. In official American and English draughts, ordinary men capture FORWARD ONLY; an uncrowned man can never jump backward, no matter what. In international draughts, ordinary men may capture both forward and backward. Get this wrong and you will either miss legal jumps or attempt illegal ones.' },
        { h: 'Flying kings, or not' },
        { p: 'In American and English checkers the king is not a flying king: it moves and captures one square at a time, just in both directions. In international draughts the king flies, sliding any distance along an open diagonal and capturing from afar. The flying king is so strong that promotion changes the whole character of the 10×10 game.' },
        { h: 'The maximum-capture rule' },
        { p: 'All these versions make capturing mandatory, but they differ on which capture. In American and English draughts there is no maximum rule: if several jumps are available you may choose any of them. In international draughts you must take the capture that wins the most pieces. So one game lets you pick your favorite jump while the other forces the greediest one.' },
        { h: 'Board size and casual rules' },
        { p: 'American and English checkers use an 8×8 board with twelve men a side; international draughts uses a 10×10 board with twenty men a side. Beyond the official codes, many people play a relaxed or casual rule set that drops the strictest requirements, often allowing you to skip a capture, ignore the must-jump-the-most rule, or let men jump backward, simply to keep friendly games easy and forgiving. There is nothing wrong with casual rules, just agree on them before you start.' }
      ]
    },
    {
      id: 'ck_strategy_basics',
      cat: 'Checkers',
      icon: '\u{1F451}',
      title: 'Checkers Strategy Basics',
      blurb: 'Control the center, guard your back row, trade when ahead, and dream of a king.',
      mins: 5,
      body: [
        { h: 'Fight for the center' },
        { p: 'Just as in chess, the middle of the board is where your pieces have the most options. Pieces pushed toward the center control more squares and can swing to either side, while pieces stuck on the edges have fewer moves and are easier to trap. Steer your men toward the central squares in the opening rather than crowding the rim.' },
        { h: 'Hold your back row early' },
        { p: 'The row of pieces nearest you is your back row, and it does double duty: it guards the squares an enemy needs to reach to be crowned. Keeping your back row intact in the early game makes it hard for your opponent to promote a man into a king. Do not give up those guarding pieces without a good reason; an open back row is an invitation to a new enemy king.' },
        { h: 'Trade when you are ahead' },
        { p: 'If you have captured more pieces than your opponent, every even trade helps you, because the fewer pieces remain, the larger your extra piece looms. When you are ahead in material, look for chances to swap pieces one for one. When you are behind, do the opposite and keep pieces on the board to preserve your chances.' },
        { h: 'Tempo, the move, and free jumps' },
        { p: 'Because captures are mandatory, you can sometimes force your opponent into a jump that helps you, a bit like the opposition in a king endgame, where being forced to move is a disadvantage. Set traps where any jump they make lets you recapture more than you lose. The flip side: never leave a man sitting where the opponent gets a free jump, especially a chain that sweeps up several of your pieces at once.' },
        { h: 'Make kings, and respect the flying king' },
        { p: 'Crowning a man is one of the surest ways to take over a game, so push toward promotion while blocking your opponent from doing the same. In the 8×8 game a king is a strong two-way fighter. In the 10×10 game a single flying king can dominate the whole board from a safe distance, so racing to the first flying king is often the entire plan.' }
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
