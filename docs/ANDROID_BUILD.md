# Android build runbook

This document explains how to refresh the Capacitor bundle, regenerate
the Android project, smoke-test it on an emulator, and produce a signed
AAB for Play Store upload.

## 0. App identity (do not change)

- Application ID: `com.chesstrophies.app` (PERMANENT after first Play upload)
- App name: ChessTrophies
- minSdkVersion 22 / targetSdkVersion 34 / compileSdkVersion 34
- versionCode 1 / versionName "1.0.0"

These live in `android/variables.gradle` (SDK levels) and
`android/app/build.gradle` (appId, versionCode, versionName).

## 1. Refresh the Capacitor bundle from the repo root

`www/` is a staged copy of the client files and is gitignored. Whenever
you change any client file at the repo root, re-stage. NOTE: the staging
list below includes every script index.html actually loads (the original
scaffold prompt under-listed these; this is the corrected list).

```bash
rm -rf www
mkdir -p www
cp index.html app.js academy.js sounds.js stockfish-ai.js \
   chess.min.js chess960.js config.js puzzles-data.js puzzles.js \
   review.js trophy-extras.js learn-library.js sw.js manifest.json \
   terms.html privacy.html \
   icon.svg icon-192.png icon-512.png icon-1024.png www/
```

There is no `vendor/` directory; the vendored chess engine is
`chess.min.js` + `chess960.js` at the repo root and is included above.

Then re-apply the two patches to `www/index.html` (NOT the repo root):

1. CSP: the connect-src directive must include Railway HTTPS+WSS and
   Vercel HTTPS:

   ```
   connect-src 'self' https://chesstrophies-production.up.railway.app https://playchesstrophies.com wss://chesstrophies-production.up.railway.app;
   ```

2. Service worker guard: the registration must be wrapped so it does not
   run inside Capacitor:

   ```js
   if (!window.Capacitor && 'serviceWorker' in navigator) {
     window.addEventListener('load', function () {
       navigator.serviceWorker.register('sw.js').catch(function (err) {
         console.warn('Service worker registration skipped:', err);
       });
     });
   }
   ```

## 2. Sync into the Android project

```bash
npx cap sync android
```

Verify the patches landed in the bundled copy:

```bash
grep -o 'playchesstrophies.com' android/app/src/main/assets/public/index.html
grep -c 'window.Capacitor' android/app/src/main/assets/public/index.html
```

## 3. Smoke-test on an emulator

```bash
npx cap open android   # opens Android Studio
```

In Android Studio: start an emulator (API 22+), Run 'app'. Confirm the
app loads, talks to the Railway backend (login / matchmaking), and that
there is no white screen (which would indicate the SW guard failed).

## 4. Produce a signed AAB

1. In Android Studio: Build > Generate Signed Bundle / APK > Android App
   Bundle.
2. Create or select an upload keystore. KEEP THIS KEYSTORE SAFE AND
   BACKED UP — losing it means you cannot ship updates under the same
   app. Do not commit the keystore to git.
3. Build the release AAB. Output lands in
   `android/app/release/app-release.aab`.
4. Upload the AAB in Google Play Console under your app's release track.

## 5. Bumping versions for later releases

For each new Play release, increment `versionCode` (integer) and update
`versionName` in `android/app/build.gradle`, then repeat steps 1-4.
