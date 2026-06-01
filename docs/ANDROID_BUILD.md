# Android build runbook

This document explains how to refresh the Capacitor bundle, regenerate
the Android project, smoke-test it on an emulator, and produce a signed
AAB for Play Store upload.

## 0. App identity (do not change)

- Application ID: `com.chesstrophies.app` (PERMANENT after first Play upload)
- App name: ChessTrophies
- minSdkVersion 22 / targetSdkVersion 36 / compileSdkVersion 36
- versionCode 1 / versionName "1.0.0"

SDK levels live in `android/variables.gradle`; appId, versionCode, and
versionName live in `android/app/build.gradle` (inside defaultConfig).

## 1. Refresh the Capacitor bundle from the repo root

`www/` is a staged copy of the client files and is gitignored, so it must
be regenerated and re-patched on every refresh. NOTE: this staging list
includes every script index.html actually loads. There is no `vendor/`
directory; the vendored chess engine is `chess.min.js` + `chess960.js`
at the repo root and is included below.

```bash
rm -rf www
mkdir -p www
cp index.html app.js academy.js sounds.js stockfish-ai.js \
   chess.min.js chess960.js config.js puzzles-data.js puzzles.js \
   review.js trophy-extras.js learn-library.js sw.js manifest.json \
   terms.html privacy.html \
   icon.svg icon-192.png icon-512.png icon-1024.png www/
```

Then re-apply the two patches to `www/index.html` (NOT the repo root):

1. CSP fix — the connect-src directive must allow Railway HTTPS+WSS and
   Vercel HTTPS:

   ```
   connect-src 'self' https://chesstrophies-production.up.railway.app https://playchesstrophies.com wss://chesstrophies-production.up.railway.app;
   ```

2. Service worker guard — wrap the SW registration:

   ```js
   if (!window.Capacitor && 'serviceWorker' in navigator) {
     window.addEventListener('load', function () {
       navigator.serviceWorker.register('sw.js').catch(function (err) {
         console.warn('Service worker registration failed:', err);
       });
     });
   }
   ```

Both patches must be re-applied on every refresh because www/ is
gitignored. If this becomes annoying, write a scripts/refresh-www.sh that
performs the copy + sed substitutions automatically.

Sync to Android after refresh:

```bash
npx cap sync
```

## 2. Smoke test on emulator (requires Android Studio)

Cannot be done in Codespaces — needs a local machine with Android Studio
installed.

```bash
npx cap open android
```

In Android Studio:

1. Wait for Gradle sync to complete (status bar at the bottom).
2. Tools -> Device Manager -> Create Device -> Pixel 6 -> API 34
   (must be a "Google Play" image, not just "Google APIs").
3. Click the green Run button.
4. Emulator boots; ChessTrophies should appear.
5. Test signup. If the request reaches Railway and returns a user,
   the wrapped app works end-to-end.

If the page is blank: open Chrome DevTools by enabling remote debugging
(chrome://inspect in desktop Chrome while the emulator is running) and
check the console for errors.

If signup fails with a network error: the CSP fix above didn't apply.
Verify www/index.html includes the Railway URL in connect-src and re-run
npx cap sync.

## 3. Build the signed AAB

In Android Studio:

1. Build -> Generate Signed Bundle / APK -> Android App Bundle -> Next.
2. Use the project keystore. DO NOT lose this file. Back it up to three
   places:
   - Encrypted external drive
   - Password manager (1Password / Bitwarden)
   - Encrypted cloud backup
   Losing it = you can never update the app on the same Play Store
   listing again. The keystore is the single most critical artifact.
3. Build variant: release. Output: android/app/release/app-release.aab.

Upload that .aab to Play Console -> Testing -> Closed testing -> Create
new release.

## 4. Version bumping for updates

For every Play Store upload:

- Bump versionCode by 1 (integer, must increment monotonically)
- Bump versionName per semver (e.g. 1.0.0 -> 1.0.1)

Both in android/app/build.gradle, inside defaultConfig.

## 5. CSP for Vercel-hosted client (future work)

The repo-root index.html has a connect-src CSP that allows Railway but
not the Vercel origin. When SERVER_URL is wired into app.js so the
Vercel-hosted client talks to Railway directly, the same connect-src
edit in this runbook (adding the Vercel origin / confirming Railway +
WSS) needs to be applied to the repo-root file too. For now, only the
Capacitor bundle (www/index.html) has the fully loosened CSP.
