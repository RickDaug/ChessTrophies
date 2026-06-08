/* trophy-data.js — ChessTrophies achievement/trophy catalog (extracted from
 * app.js). Pure data, no DOM, no app state. Exposes the tiered trophy list on
 * window.CT_ACHIEVEMENT_TIERS; app.js reads it at load time. Each tier is its
 * own trophy and gets harder. Order here is the display order. */
(function () {
  'use strict';
  var glob = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined' ? self : this);
  glob.CT_ACHIEVEMENT_TIERS = [
    // Wins
    { id: 'wins_t1',  family: 'Wins',     type: 'wins',     threshold: 1,    tier: 1, icon: '🥇', name: 'First Blood',    desc: 'Win 1 ranked game.' },
    { id: 'wins_t2',  family: 'Wins',     type: 'wins',     threshold: 5,    tier: 2, icon: '🥈', name: 'Triumphant',     desc: 'Win 5 ranked games.' },
    { id: 'wins_t3',  family: 'Wins',     type: 'wins',     threshold: 10,   tier: 3, icon: '🥉', name: 'Conqueror',      desc: 'Win 10 ranked games.' },
    { id: 'wins_t4',  family: 'Wins',     type: 'wins',     threshold: 25,   tier: 4, icon: '🏅', name: 'Dominant',       desc: 'Win 25 ranked games.' },
    { id: 'wins_t5',  family: 'Wins',     type: 'wins',     threshold: 50,   tier: 5, icon: '🎖️', name: 'Legendary',      desc: 'Win 50 ranked games.' },
    { id: 'wins_t6',  family: 'Wins',     type: 'wins',     threshold: 100,  tier: 6, icon: '👑', name: 'Master',         desc: 'Win 100 ranked games.' },
    { id: 'wins_t7',  family: 'Wins',     type: 'wins',     threshold: 250,  tier: 7, icon: '💠', name: 'Grandmaster',    desc: 'Win 250 ranked games.' },
    // Streaks
    { id: 'streak_t1',family: 'Streak',   type: 'streak',   threshold: 3,    tier: 1, icon: '🔥', name: 'On Fire',        desc: 'Win 3 in a row.' , repeatable: true },
    { id: 'streak_t2',family: 'Streak',   type: 'streak',   threshold: 5,    tier: 2, icon: '⚡', name: 'Inferno',        desc: 'Win 5 in a row.' , repeatable: true },
    { id: 'streak_t3',family: 'Streak',   type: 'streak',   threshold: 7,    tier: 3, icon: '☄️', name: 'Seven Saints',   desc: 'Win 7 in a row.' , repeatable: true },
    { id: 'streak_t4',family: 'Streak',   type: 'streak',   threshold: 10,   tier: 4, icon: '🌟', name: 'Unstoppable',    desc: 'Win 10 in a row.' , repeatable: true },
    { id: 'streak_t5',family: 'Streak',   type: 'streak',   threshold: 14,   tier: 5, icon: '✨', name: 'Double Crown',   desc: 'Win 14 in a row.' , repeatable: true },
    { id: 'streak_t6',family: 'Streak',   type: 'streak',   threshold: 21,   tier: 6, icon: '🌠', name: 'Ascendant',      desc: 'Win 21 in a row.' , repeatable: true },
    { id: 'streak_t7',family: 'Streak',   type: 'streak',   threshold: 30,   tier: 7, icon: '🛡️', name: 'Immortal',       desc: 'Win 30 in a row.' , repeatable: true },
    // Rating (ELO)
    { id: 'elo_t1',   family: 'Rating',   type: 'elo',      threshold: 1300, tier: 1, icon: '📈', name: 'Climber',        desc: 'Reach 1300 ELO.' },
    { id: 'elo_t2',   family: 'Rating',   type: 'elo',      threshold: 1400, tier: 2, icon: '📈', name: 'Climber II',     desc: 'Reach 1400 ELO.' },
    { id: 'elo_t3',   family: 'Rating',   type: 'elo',      threshold: 1500, tier: 3, icon: '🚀', name: 'Rising Star',    desc: 'Reach 1500 ELO.' },
    { id: 'elo_t4',   family: 'Rating',   type: 'elo',      threshold: 1600, tier: 4, icon: '🚀', name: 'Sharp',          desc: 'Reach 1600 ELO.' },
    { id: 'elo_t5',   family: 'Rating',   type: 'elo',      threshold: 1700, tier: 5, icon: '💎', name: 'Expert',         desc: 'Reach 1700 ELO.' },
    { id: 'elo_t6',   family: 'Rating',   type: 'elo',      threshold: 1800, tier: 6, icon: '💎', name: 'Candidate',      desc: 'Reach 1800 ELO.' },
    { id: 'elo_t7',   family: 'Rating',   type: 'elo',      threshold: 2000, tier: 7, icon: '👑', name: 'Titled',         desc: 'Reach 2000 ELO.' },
    { id: 'elo_t8',   family: 'Rating',   type: 'elo',      threshold: 2200, tier: 8, icon: '🏆', name: 'Senior Master',  desc: 'Reach 2200 ELO.' },
    // Fast wins (in N moves or fewer)
    { id: 'fast_t1',  family: 'Fast Win', type: 'fast',     threshold: 30,   tier: 1, icon: '⏱️', name: 'Lightning',      desc: 'Win in ≤30 moves.' , repeatable: true },
    { id: 'fast_t2',  family: 'Fast Win', type: 'fast',     threshold: 20,   tier: 2, icon: '⚡', name: 'Thunder',        desc: 'Win in ≤20 moves.' , repeatable: true },
    { id: 'fast_t3',  family: 'Fast Win', type: 'fast',     threshold: 15,   tier: 3, icon: '🌪️', name: 'Blitz Master',  desc: 'Win in ≤15 moves.' , repeatable: true },
    { id: 'fast_t4',  family: 'Fast Win', type: 'fast',     threshold: 10,   tier: 4, icon: '💥', name: 'Brilliance',     desc: 'Win in ≤10 moves.' , repeatable: true },
    // Games played
    { id: 'games_t1', family: 'Veteran',  type: 'games',    threshold: 10,   tier: 1, icon: '🎯', name: 'Tested',         desc: 'Play 10 ranked games.' },
    { id: 'games_t2', family: 'Veteran',  type: 'games',    threshold: 50,   tier: 2, icon: '🏛️', name: 'Seasoned',       desc: 'Play 50 ranked games.' },
    { id: 'games_t3', family: 'Veteran',  type: 'games',    threshold: 100,  tier: 3, icon: '🗿', name: 'Hardened',       desc: 'Play 100 ranked games.' },
    { id: 'games_t4', family: 'Veteran',  type: 'games',    threshold: 250,  tier: 4, icon: '🌌', name: 'Eternal',        desc: 'Play 250 ranked games.' },
    // Checkmates delivered
    { id: 'mate_t1',  family: 'Mates',    type: 'mate',     threshold: 1,    tier: 1, icon: '♛', name: 'Mate Maker',      desc: 'Win 1 game by checkmate.' },
    { id: 'mate_t2',  family: 'Mates',    type: 'mate',     threshold: 5,    tier: 2, icon: '♕', name: 'Executioner',     desc: 'Win 5 games by checkmate.' },
    { id: 'mate_t3',  family: 'Mates',    type: 'mate',     threshold: 25,   tier: 3, icon: '☠️', name: 'Reaper',         desc: 'Win 25 games by checkmate.' },
    { id: 'mate_t4',  family: 'Mates',    type: 'mate',     threshold: 100,  tier: 4, icon: '🔱', name: 'Mate Machine',    desc: 'Win 100 games by checkmate.' },
    // Comebacks (won after being in check 3+ times)
    { id: 'come_t1',  family: 'Comeback', type: 'comeback', threshold: 1,    tier: 1, icon: '🛡️', name: 'Comeback Kid',   desc: 'Win after being checked 3+ times once.' },
    { id: 'come_t2',  family: 'Comeback', type: 'comeback', threshold: 5,    tier: 2, icon: '🛡️', name: 'Houdini',        desc: 'Pull off 5 dramatic comebacks.' },
    { id: 'come_t3',  family: 'Comeback', type: 'comeback', threshold: 10,   tier: 3, icon: '🦅', name: 'Phoenix',        desc: 'Pull off 10 dramatic comebacks.' },
    // Special: Community / Recruiter (rare)
    { id: 'recruit_t1', family: 'Community', type: 'invites',  threshold: 1,   tier: 1, icon: '👋', name: 'Welcoming Soul',  desc: 'Invite 1 friend who actually joins.' },
    { id: 'recruit_t2', family: 'Community', type: 'invites',  threshold: 3,   tier: 2, icon: '🤝', name: 'Connector',       desc: 'Invite 3 friends who actually join.' },
    { id: 'recruit_t3', family: 'Community', type: 'invites',  threshold: 10,  tier: 3, icon: '📨', name: 'Recruiter',       desc: 'Invite 10 friends who actually joined. Rare.' },
    // Hidden chess-feat trophies — shown as ??? until earned
    { id: 'hidden_underpromo',  family: 'Hidden Feats', type: 'flag', flag: 'underpromoWins',  threshold: 1, tier: 1, icon: '🐴', name: 'Underpromotion',   desc: 'Win by promoting to a piece other than a queen.', hidden: true , repeatable: true },
    { id: 'hidden_en_passant',  family: 'Hidden Feats', type: 'flag', flag: 'enPassants',      threshold: 3, tier: 1, icon: '🕊️', name: 'En Passant Sage',  desc: 'Make 3 en passant captures across your games.', hidden: true },
    { id: 'hidden_queenside',   family: 'Hidden Feats', type: 'flag', flag: 'queensideCastles',threshold: 3, tier: 1, icon: '🏰', name: 'Long Castle',      desc: 'Castle queenside (O-O-O) in 3 games.', hidden: true },
    { id: 'hidden_bare_bones',  family: 'Hidden Feats', type: 'flag', flag: 'bareBonesWins',   threshold: 1, tier: 1, icon: '🦴', name: 'Bare Bones',       desc: 'Win a game with only king + one piece remaining.', hidden: true , repeatable: true },
    { id: 'hidden_smothered',   family: 'Hidden Feats', type: 'flag', flag: 'smotheredGiven',  threshold: 1, tier: 1, icon: '😶‍🌫️', name: 'Smothered in the Wild', desc: 'Deliver smothered mate against a real opponent.', hidden: true , repeatable: true },
    { id: 'hidden_marathon',    family: 'Hidden Feats', type: 'flag', flag: 'marathonWins',    threshold: 1, tier: 1, icon: '🏃', name: 'Marathon Runner',  desc: 'Win a game lasting 50+ full moves.', hidden: true , repeatable: true },
    { id: 'hidden_lightning',   family: 'Hidden Feats', type: 'flag', flag: 'lightningWins',   threshold: 1, tier: 1, icon: '⚡', name: 'Lightning Strike', desc: 'Win a ranked game in 10 moves or fewer.', hidden: true , repeatable: true },
    { id: 'hidden_phoenix',     family: 'Hidden Feats', type: 'flag', flag: 'phoenixRises',    threshold: 1, tier: 1, icon: '🔥', name: 'Phoenix Rises',    desc: 'Win immediately after losing 3 ranked games in a row.', hidden: true , repeatable: true },
    { id: 'hidden_pawn_promo',  family: 'Hidden Feats', type: 'flag', flag: 'pawnPromotions',  threshold: 10, tier: 1, icon: '👶', name: 'Pawn Pusher',      desc: 'Promote 10 pawns across all your games.', hidden: true },
    { id: 'hidden_bongcloud',   family: 'Hidden Feats', type: 'flag', flag: 'bongcloudWins',   threshold: 1, tier: 1, icon: '☁️', name: 'The Bongcloud',    desc: 'Win after playing 1.e4 and 2.Ke2 (the Bongcloud).', hidden: true , repeatable: true },
    // Hidden daily play-streak trophies — consecutive days the user finishes any game
    { id: 'hidden_play_streak_7',   family: 'Hidden Feats', type: 'flag', flag: 'dailyPlayStreak', threshold: 7,   tier: 1, icon: '📅', name: 'Seven-Day Habit',  desc: 'Play a game on 7 days in a row.',   hidden: true },
    { id: 'hidden_play_streak_30',  family: 'Hidden Feats', type: 'flag', flag: 'dailyPlayStreak', threshold: 30,  tier: 1, icon: '📆', name: 'Monthly Regular',  desc: 'Play a game on 30 days in a row.',  hidden: true },
    { id: 'hidden_play_streak_90',  family: 'Hidden Feats', type: 'flag', flag: 'dailyPlayStreak', threshold: 90,  tier: 1, icon: '🗓️', name: 'Quarter Devotion', desc: 'Play a game on 90 days in a row.',  hidden: true },
    { id: 'hidden_play_streak_365', family: 'Hidden Feats', type: 'flag', flag: 'dailyPlayStreak', threshold: 365, tier: 1, icon: '🏆', name: 'Year of Chess',    desc: 'Play a game on 365 days in a row.', hidden: true },
    // Embarrassing fail trophies
    { id: 'oops_whoops',        family: 'Oops', type: 'flag', flag: 'fastLosses',          threshold: 1, tier: 1, icon: '🤦', name: 'Whoops',                desc: 'Get checkmated in 10 moves or fewer.', embarrassing: true , repeatable: true },
    { id: 'oops_punching_bag',  family: 'Oops', type: 'flag', flag: 'sameOppLossStreak',   threshold: 5, tier: 1, icon: '🥊', name: 'Punching Bag',          desc: 'Lose 5 ranked games in a row to the same opponent.', embarrassing: true },
    { id: 'oops_dry_spell',     family: 'Oops', type: 'flag', flag: 'drySpellTriggered',   threshold: 1, tier: 1, icon: '🏜️', name: 'Dry Spell',            desc: 'Go 7 days without a win, playing on 4+ different days.', embarrassing: true },
    { id: 'oops_resign_addict', family: 'Oops', type: 'flag', flag: 'resignStreak',        threshold: 5, tier: 1, icon: '🏳️', name: 'Quitter',              desc: 'Resign 5 games in a row.', embarrassing: true },
    { id: 'oops_mate_magnet',   family: 'Oops', type: 'flag', flag: 'mateLossStreak',      threshold: 3, tier: 1, icon: '🧲', name: 'Mate Magnet',           desc: 'Get checkmated 3 ranked games in a row.', embarrassing: true },
    { id: 'oops_flatline',      family: 'Oops', type: 'flag', flag: 'loseStreak',          threshold: 10, tier: 1, icon: '📉', name: 'Flatline',              desc: 'Lose 10 ranked games in a row.', embarrassing: true },
    { id: 'oops_quick_loss',    family: 'Oops', type: 'flag', flag: 'veryQuickLosses',     threshold: 1, tier: 1, icon: '💨', name: 'Quick Out',             desc: 'Lose a ranked game in 15 moves or fewer.', embarrassing: true , repeatable: true },
    { id: 'oops_pawn_pusher',   family: 'Oops', type: 'flag', flag: 'pawnsOnlyLosses',     threshold: 1, tier: 1, icon: '🥖', name: 'Just Pawns',            desc: 'Lose with only pawns left (no minor or major pieces).', embarrassing: true , repeatable: true },
    { id: 'oops_doormat',       family: 'Oops', type: 'flag', flag: 'doormatTriggered',    threshold: 1, tier: 1, icon: '😬', name: 'The Doormat',           desc: 'Drop below 25% win rate with 20+ ranked games.', embarrassing: true },
    { id: 'oops_cold_streak',   family: 'Oops', type: 'flag', flag: 'coldStreakTriggered', threshold: 1, tier: 1, icon: '🥶', name: 'Cold Streak',           desc: 'Go 30 days without a win.', embarrassing: true },
    { id: 'duo_first', family: 'Duo', type: 'duo', threshold: 1, tier: 1, icon: '🤝', name: 'Better Together', desc: 'Play your first 2v2 team match.' },
    { id: 'duo_win1', family: 'Duo', type: 'duo', threshold: 1, tier: 1, icon: '🌟', name: 'Dream Team', desc: 'Win your first 2v2 match.' },
    { id: 'duo_win10', family: 'Duo', type: 'duo', threshold: 10, tier: 2, icon: '🔥', name: 'Tag Team', desc: 'Win 10 2v2 matches.' },
    { id: 'duo_win25', family: 'Duo', type: 'duo', threshold: 25, tier: 3, icon: '⚔️', name: 'Battle Buddies', desc: 'Win 25 2v2 matches.' },
    { id: 'duo_streak3', family: 'Duo', type: 'duo', threshold: 3, tier: 2, icon: '🏃', name: 'In Sync', desc: 'Win 3 2v2 matches in a row.' },
    { id: 'duo_streak5', family: 'Duo', type: 'duo', threshold: 5, tier: 3, icon: '⚡', name: 'Unstoppable Duo', desc: 'Win 5 2v2 matches in a row.' },
    { id: 'duo_synergy', family: 'Duo', type: 'duo', threshold: 10, tier: 2, icon: '🧠', name: 'Mind Meld', desc: 'Play 10 ranked 2v2 matches.' },
    { id: 'duo_maverick', family: 'Duo', type: 'duo', threshold: 20, tier: 2, icon: '🎸', name: 'Maverick', desc: 'Play 20 ranked 2v2 matches.' },
    { id: 'duo_2400', family: 'Duo', type: 'duo', threshold: 1, tier: 3, icon: '👑', name: 'Duo Royalty', desc: 'Reach 1600 2v2 rating.' },
    { id: 'duo_comeback', family: 'Duo', type: 'duo', threshold: 1, tier: 3, icon: '🔄', name: 'Clutch Comeback', desc: 'Win a 2v2 after being down a queen.' },
    // ---------------------------------------------------------------------------
    // CHECKERS / DRAUGHTS family — scoped independently of chess.
    // INTEGRATION CONTRACT: the types below are evaluated by a LATER change to
    // checkAchievementsFor in app.js, against the user's CHECKERS stats:
    //   type 'checkers_elo'   -> compare user's checkers Elo            >= threshold
    //   type 'checkers_games' -> compare user's checkers ranked-game count >= threshold
    //   type 'flag' (ck* flags) -> compare user.flags[flag] (>=1) for checkers feats
    // Flag names are checkers-scoped, prefixed 'ck':
    //   ckTripleJump    -> landed a triple (3-piece) capture in one turn
    //   ckFlyingKingWin -> won a 10x10 game with a flying king
    //   ckShutout       -> won without losing a single piece
    // SAFE TO ADD NOW: checkAchievementsFor's switch has no unlocking default, so
    // unknown types ('checkers_elo'/'checkers_games') leave ok=false and stay
    // LOCKED until the integration lands; the generic 'flag' case already exists
    // but reads user.flags[...], which stays falsy until checkers play sets it.
    // Nothing breaks; these simply remain locked.
    // Checkers Elo tiers (mirrors the chess Rating family icons/tiers)
    { id: 'ck_elo_t1', family: 'Checkers', type: 'checkers_elo',   threshold: 1300, tier: 1, icon: '📈', name: 'Draughts Climber',  desc: 'Reach 1300 checkers Elo.' },
    { id: 'ck_elo_t2', family: 'Checkers', type: 'checkers_elo',   threshold: 1500, tier: 3, icon: '🚀', name: 'Draughts Riser',    desc: 'Reach 1500 checkers Elo.' },
    { id: 'ck_elo_t3', family: 'Checkers', type: 'checkers_elo',   threshold: 1700, tier: 5, icon: '💎', name: 'Draughts Expert',   desc: 'Reach 1700 checkers Elo.' },
    { id: 'ck_elo_t4', family: 'Checkers', type: 'checkers_elo',   threshold: 2000, tier: 7, icon: '👑', name: 'Draughts Titled',   desc: 'Reach 2000 checkers Elo.' },
    // Checkers ranked games played
    { id: 'ck_games_t1', family: 'Checkers', type: 'checkers_games', threshold: 10,  tier: 1, icon: '⛀', name: 'Crowned Beginner', desc: 'Play 10 ranked checkers games.' },
    { id: 'ck_games_t2', family: 'Checkers', type: 'checkers_games', threshold: 50,  tier: 2, icon: '⛂', name: 'Board Regular',    desc: 'Play 50 ranked checkers games.' },
    { id: 'ck_games_t3', family: 'Checkers', type: 'checkers_games', threshold: 200, tier: 4, icon: '⛃', name: 'Draughts Veteran',  desc: 'Play 200 ranked checkers games.' },
    // Hidden checkers feats — shown as ??? until earned
    { id: 'ck_hidden_triple_jump',  family: 'Checkers', type: 'flag', flag: 'ckTripleJump',    threshold: 1, tier: 1, icon: '🤹', name: 'Triple Jump',     desc: 'Land a triple (3-piece) capture in a single turn.', hidden: true , repeatable: true },
    { id: 'ck_hidden_flying_king',  family: 'Checkers', type: 'flag', flag: 'ckFlyingKingWin', threshold: 1, tier: 1, icon: '👑', name: 'King Takes Flight', desc: 'Win a 10×10 game with a flying king.', hidden: true , repeatable: true },
    { id: 'ck_hidden_shutout',      family: 'Checkers', type: 'flag', flag: 'ckShutout',       threshold: 1, tier: 1, icon: '🛡️', name: 'Flawless Sweep',  desc: 'Win a checkers game without losing a single piece.', hidden: true , repeatable: true },
  ];
})();
