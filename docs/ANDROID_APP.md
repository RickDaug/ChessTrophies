# ChessTrophies for Android

The Android app is a **Trusted Web Activity**: a small native shell
(`android/`, package `com.chesstrophies.app`) that opens
`https://www.playchesstrophies.com` full-screen in the phone's own browser
engine. It carries no copy of the site. A web deploy is an app update; there
is nothing to re-sync and nothing to rebuild unless the shell itself changes.

This replaces the Capacitor wrapper removed on 2026-06-07, which bundled a
copy of the client (`www/`) that had to be regenerated before every build.

## What is in the shell

| Thing | Where | Source of truth |
| --- | --- | --- |
| Package id, version, SDK levels | `android/app/build.gradle` | — |
| Start URL, host, app name | `android/app/src/main/res/values/strings.xml` | the live site |
| Splash + status-bar colour | `res/values/colors.xml` | `manifest.json` `background_color` |
| Launcher icon | `res/mipmap-*`, `res/drawable/ic_launcher_foreground.xml` | `icon.svg` |
| Long-press shortcuts | `res/xml/shortcuts.xml` | `manifest.json` `shortcuts` |

Minimum Android 7.0 (API 24, required by `androidbrowserhelper`); targets API 36.

## Build

Needs a JDK 17+ (Android Studio's bundled one works) and the Android SDK.
`android/local.properties` (gitignored) points at the SDK: `sdk.dir=...`.

```
cd android
./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk   (install on a phone)
./gradlew bundleRelease     # app/build/outputs/bundle/release/app-release.aab (upload to Play)
```

Install the debug build on a phone with USB debugging on:
`adb install -r app/build/outputs/apk/debug/app-debug.apk`

## The trust link (why there is no address bar)

Android shows the site full-screen only if the site vouches for the app.
Two halves must agree:

- **App half:** `assetStatements` in `strings.xml` names the site.
- **Site half:** `/.well-known/assetlinks.json` names the package and the
  SHA-256 fingerprint of the certificate the installed app was signed with.
  The file lives at `.well-known/assetlinks.json` in the repo root;
  `scripts/build.mjs` copies it into `dist/`, and `test/build-smoke.mjs`
  fails if it is missing or names a different package.

If the fingerprint does not match, the app still works but opens the site in
a Custom Tab with an address bar.

**Each signing certificate needs its own fingerprint in the list.** Right now
the file holds one: the debug certificate of the development machine, so a
debug build installed from that machine runs full-screen. Before release, add:

1. the **Play app signing** certificate fingerprint (Play Console → your app →
   Test and release → Setup → App signing → "SHA-256 certificate fingerprint").
   This is the one real users' installs are signed with.
2. optionally the **upload key** fingerprint, if you want to sideload release
   builds. `keytool -list -v -keystore <file>` prints it.

Then remove the debug fingerprint and deploy the site.

## Releasing to Google Play (owner steps)

1. Create an upload keystore and keep it OUT of the repo (`*.jks` and
   `keystore.properties` are gitignored). Back it up somewhere safe.
2. Write `android/keystore.properties`:
   ```
   storeFile=/absolute/path/to/upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
3. `./gradlew bundleRelease` now produces a signed `.aab`.
4. In Play Console, create the app as `com.chesstrophies.app`, enrol in Play
   App Signing, upload the `.aab` to a testing track.
5. Copy the Play signing fingerprint into `.well-known/assetlinks.json`
   (above), merge, and let the site deploy.
6. For each later upload, raise `versionCode` in `android/app/build.gradle`.

## Not verified yet

The shell has been built (debug APK and release bundle) but has not been run
on a phone or emulator. First install should check: full-screen with no
address bar (after the site deploy that carries `assetlinks.json`), sign-in,
a game against the computer, an online game (Socket.IO to Railway), and the
notification prompt.
