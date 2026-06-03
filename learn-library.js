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
        { p: 'The cure is a small, quiet move called making luft, a German word for air. You simply push one of the pawns in front of your king up a square, usually the one in front of the knight, opening a little escape hatch. Now if a rook checks along the back rank, your king has a square to flee to, and the mate evaporates. One tiny pawn move buys lasting peace of mind.' },
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
        { p: 'To take the opposition, aim to be the one moving your king to face the enemy king with one square between you, so that they must move next. A handy guide: when there is an odd number of squares between the kings on the file, the player to move can usually seize the opposition. It feels abstract at first, but set up a king and pawn against a king and push them around, and within an afternoon the pattern clicks. Master this single idea and you will win endgames that you used to throw away.' }
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
