# Front-end & UX — Squad Report

**Score:** 74 / 100  ·  **Findings:** 5×S2 · 4×S3

Verified 9 raw findings against source. The chess board, modal, and bottom-nav have genuinely strong accessibility (role=grid, roving tabindex, arrow-key nav, focus trap, aria-current), and reduced-motion is honored in most places — so the domain is above-average, not broken. But there is a real cluster of accessibility-completeness gaps that the green a11y gate masks: the entire checkers mode has zero keyboard/SR support, all .tab controls are non-focusable divs (blocking keyboard signup and the chess/checkers switch), there are no aria-live/status regions, and the RTL locales mirror the board. Confirmed 7 findings (3×S2, 4×S3), downgraded the S1 casual-matchmaking finding to S2 (it degrades gracefully), and rejected 1 obvious placeholder. No S0/S1 survived.

---

### 1. Checkers board is completely inaccessible to keyboard and screen-reader users  `S2` — _CONFIRMED_

**Evidence:** ct-checkers.js:157-181 builds each square as a plain <div class='ck-sq'> with only a click listener (line 179). A grep for role=/gridcell/aria-label/tabindex/keydown/ArrowUp across ct-checkers.js AND checkers.js returns NOTHING (verified). By contrast app.js:3907-3979 gives the chess board role=grid + aria-label, per-square role=gridcell + squareAriaLabel(), a roving tabindex (exactly one .sq[data-sq] is tabIndex 0), and an onBoardKey keydown handler. test/a11y.mjs never references 'checkers'.

**Impact:** On a product marketed as 'chess + checkers', a full core game mode is unplayable by keyboard-only and blind/low-vision users: cells cannot receive focus, cannot be activated without a pointer, and are announced as anonymous divs. The passing a11y gate hides this because it only exercises the chess board.

**Recommendation:** Port the chess board's pattern to ct-checkers.js: role=grid on the container, role=gridcell + descriptive aria-label per playable square, a single roving tabIndex=0 cursor, and a keydown handler (arrows + Enter). Extend test/a11y.mjs (or add a11y-checkers.mjs) to drive a checkers game by keyboard.

### 2. Tab controls are non-focusable divs, blocking keyboard account creation and the chess/checkers switch  `S2` — _CONFIRMED_

**Evidence:** Auth tabs index.html:837-838 <div class='tab' data-tab='login'/'signup'> — no tabindex/role; both forms start display:none (index.html:841,853) and are shown only by a click handler bound at app.js:1253-1260. Gametype tabs index.html:1123-1124 <div class='tab' data-gametype='chess'/'checkers'>, click-only handler app.js:2296. Rankings metric tabs index.html:1452-1457 + app.js:5467-5469. A grep for role="tab"/aria-selected across app.js and index.html returns NOTHING; active state is conveyed only by a .active class. No keydown handler exists on any .tab.

**Impact:** A keyboard-only user on the auth screen can reach the login fields and guest button but cannot activate the 'Create account' tab, so signup is unreachable by keyboard. The same barrier blocks switching Chess→Checkers in the lobby and changing the rankings metric. Violates WCAG 2.1.1 (Keyboard) and 4.1.2 (Name/Role/Value).

**Recommendation:** Make the tab controls real <button> (or add role='tab' + tabindex + aria-selected + an Enter/arrow keydown handler), mirroring the fix already applied to #bottom-nav (whose items are real <button>s per test/a11y.mjs). Add a keyboard-activation assertion for at least the auth and gametype tabs.

### 3. No aria-live/status regions: errors, toasts, and game state are silent to screen readers  `S2` — _CONFIRMED_

**Evidence:** grep -c 'aria-live' index.html = 0 (verified); no role='alert'/role='status' anywhere in index.html or app.js. Login/signup errors are set via textContent on plain divs (#login-error set app.js:1275, #signup-error app.js:1281; markup index.html has class='error' with no role). Toasts are dynamically appended plain divs with class 'toast' and no role (app.js:1189-1197). In-game status (check/turn/'AI thinking') is rendered visually only.

**Impact:** Screen-reader users get no feedback when a login fails, when a toast fires (e.g. 'Signed in offline'), or when game state changes (check/checkmate/opponent moved). Violates WCAG 4.1.3 (Status Messages) and undermines 3.3.1 (Error Identification).

**Recommendation:** Add role='alert' (aria-live='assertive') to #login-error/#signup-error, wrap the toast container in role='status' aria-live='polite', and announce turn/check/result via a visually-hidden polite live region updated in renderBoard()/finishGame().

### 4. Casual online matchmaking dead-ends with no bot backfill (empty-pool pre-launch)  `S2` — _CONFIRMED_

**Evidence:** server/game.js:517-519 backfills only ranked ('if (nMode === "ranked" && botEngineReady()) scheduleBotBackfill'; comment: 'Casual is never backfilled'). Client startOnlineMatchmaking (app.js:2843) runs a 120s window (MATCH_SEARCH_MS=120000, app.js:2841) and on timeout leaves the queue, closes the modal, and toasts 'No opponent found right now — try again.' (app.js:2872-2874).

**Impact:** With an empty concurrent player pool (typical pre/early-launch), 'Play a casual game' (index.html:1169-1173) can only ever wait 120s and fail. It degrades gracefully (toast + retry, no stuck screen) and CAN succeed once two real users are searching at once, so this is a UX/product gap, not a hard failure — downgraded from the auditor's S1.

**Recommendation:** Either bot-backfill casual too (guarded like ranked), shorten the casual timeout with a clearer 'no one's online right now' message, or surface an alternative (play a bot / challenge a friend) at timeout instead of a bare 'try again'.

### 5. ar/ur RTL flip mirrors the game board horizontally (no direction:ltr override)  `S2` — _CONFIRMED_

**Evidence:** i18n.js:256 sets document.documentElement.dir = 'rtl' for ar/ur (registry i18n.js:55-56). The board is CSS Grid (index.html:334 '.board { display:grid; grid-template-columns: repeat(8, minmax(0,1fr)); ... }'). A grep for 'rtl'/'direction: ltr'/'[dir' in index.html returns NOTHING, so dir=rtl inherits to .board and the grid's inline (column) axis reverses, rendering the first DOM column (a-file) on the right. i18n.mjs verifies the RTL flip only on welcome/lobby/settings, never the board.

**Impact:** Arabic and Urdu users see the board mirrored left-to-right (a-file on the right, coordinate labels misplaced) — visually wrong for a standardized board. Logic still works via data-sq/data-ck, so it is a shipped, untested visual/orientation defect for two locales, not a crash.

**Recommendation:** Force 'direction: ltr' on .board / .board-wrap / .lesson-board / .rv-board and the checkers board regardless of document dir, and add an RTL board-integrity check (a-file on the left) to i18n.mjs or a11y.mjs.

### 6. Looping matchmaking/academy spinners ignore prefers-reduced-motion  `S3` — _CONFIRMED_

**Evidence:** The app honors reduced motion in several places (index.html:207,318,345,681,690; app.js:1080,1129,4059), but the matchmaking/checkers-search/arena spinners animate 'mm-pulse 1.2s ... infinite' (keyframes index.html:682; applied inline at :1770, :1785, :1822) and the learn-tree 'here' marker uses 'bounce 1.6s ... infinite' (index.html:470) — neither is covered by any @media (prefers-reduced-motion: reduce) block (verified the existing blocks target ct-spin, home-seo-card, confetti/elo-pop/trophy-shine, overlay-piece, ct-mate — not mm-pulse or bounce).

**Impact:** Users who set reduce-motion still get continuously pulsing/bouncing elements on the matchmaking, checkers-search, arena, and academy screens — inconsistent with the app's otherwise-good reduced-motion support (WCAG 2.3.3, best-practice).

**Recommendation:** Add the mm-pulse elements and .lnode .here to an existing @media (prefers-reduced-motion: reduce) block with animation:none (a static icon is fine).

### 7. Text inputs suppress the focus outline and rely on a border-color-only focus cue  `S3` — _CONFIRMED_

**Evidence:** index.html:265 sets 'outline: none' on all input[type=text/email/password/search], textarea, select; index.html:267 restores focus visibility only via 'input:focus, select:focus, textarea:focus { border-color: var(--accent); }'. The border shifts from --border (#243556) to --accent gold — a 1px, low-area change. Buttons are unaffected (no outline reset). Note: the specific inline outline:none at index.html:630/1689 cited by the auditor could not be confirmed at those exact lines, but the global rule at :265 is real.

**Impact:** The only keyboard-focus cue on form fields is a subtle 1px border color change that is easy to miss, marginal against WCAG 2.4.7 (Focus Visible). Lower severity because focus is still technically indicated and the app already uses proper :focus-visible outlines on nav/SEO links.

**Recommendation:** Replace 'outline:none' with a :focus-visible rule adding a 2px outline + offset (as already used for .nav-item / .home-seo links), keeping the border-color change as a secondary cue.

### 8. a11y regression gate covers only the chess board, masking the accessibility gaps above  `S3` — _CONFIRMED_

**Evidence:** test/a11y.mjs asserts modal role/aria/focus-trap/Escape, bottom-nav <button>s + aria-current, and the chess board grid/roving-tabindex/arrow-nav. A grep confirms it never references 'checkers', 'aria-live', or 'rtl', and its only 'tab' references (lines 125,131) are the board's roving tabIndex, not the .tab controls. So the checkers, tab-control, live-region, and RTL findings all pass CI green.

**Impact:** The green a11y test creates false confidence that the whole app is accessible when it validates roughly one screen; future regressions in checkers, tabs, status messaging, or RTL won't be caught. This is the test-coverage root cause behind the four findings above rather than a separate user-facing defect.

**Recommendation:** Extend a11y.mjs (or add a11y-checkers.mjs) to cover keyboard operation of a checkers game, keyboard activation of the auth/gametype tabs, presence of live regions for errors/toasts, and an RTL pass asserting the board is not mirrored.

### 9. [REJECTED] Placeholder 'test' finding (evidence 'file:1', impact 'x')  `S3` — _REJECTED_

**Evidence:** Raw finding #9 has title 'test', evidence 'file:1', impact 'x', recommendation 'y' — no real file, line, or substance. Not a genuine finding.

**Impact:** None — culled so the chief sees it was a stray/placeholder entry, not a real defect.

**Recommendation:** Ignore/remove.
