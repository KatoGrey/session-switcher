# Session Switcher for Android

A small companion app that turns your phone into a remote for Session Switcher running on your PC.
It is a full-screen WebView that loads the Session Switcher web UI from your PC over your Wi-Fi
(or Tailscale). Nothing runs on the phone except the WebView.

- Package: `app.sessionswitcher.remote`, version 5.0.0 (code 5), Android 7.0+ (minSdk 24, targetSdk 34)
- Plain Java against `android.jar`: no Gradle, AndroidX or Kotlin

## Building

```
node mobile/android/build.js        (or: mobile\android\build.cmd)
```

The output is `mobile/android/build/SessionSwitcher.apk`.

The script runs aapt2 (compile/link), then javac, d8, aapt add, zipalign and apksigner. It is
idempotent, and the first run fetches what's missing:

| Tool | Source | Where it goes |
| --- | --- | --- |
| JDK 17 | `$JAVA_HOME`, otherwise Temurin 17 from Adoptium | `%LOCALAPPDATA%\SessionSwitcherBuild\jdk17` |
| build-tools 34.0.0 | `$ANDROID_HOME`/`$ANDROID_SDK_ROOT`, otherwise dl.google.com | `...\SessionSwitcherBuild\build-tools-34.0.0` |
| platform android-34 | same | `...\SessionSwitcherBuild\android-34` |

Downloads are checked against the SHA-1/SHA-256 values published upstream. After the first run you
can delete `...\SessionSwitcherBuild\downloads`, because the extracted tools get reused. The extracted
toolchain takes about 560 MB.

Environment overrides: `JAVA_HOME`, `ANDROID_HOME` / `ANDROID_SDK_ROOT`, `BUILD_TOOLS_VERSION`,
`PLATFORM`, `SS_BUILD_CACHE` (cache directory). Automatic download of the JDK only works on
Windows. On other systems, set `JAVA_HOME`.

### Signing

If `mobile/android/debug.keystore` doesn't exist, the build generates it (password `android`, alias
`androiddebugkey`). The file is gitignored. Keep it: Android will only install an update over an
existing install when both APKs are signed with the same key. To use your own key, set
`KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`.

### CI

`.github/workflows/android.yml` builds the APK on `ubuntu-latest` with the runner's preinstalled
Android SDK and uploads it as the `SessionSwitcher-apk` artifact. Without a key from secrets, each
CI run signs with a new throwaway debug key. To get a stable key, add the repo secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.

### Icon

`tools/make-icon.js` writes the launcher PNGs in `res/mipmap-*` and `art/icon-512.png`. The PNGs
are committed, so you only need to rerun it after changing the design:

```
node mobile/android/tools/make-icon.js
```

## Installing on a phone

**Over USB with adb:** turn on Developer options, then USB debugging, and run

```
adb install -r mobile/android/build/SessionSwitcher.apk
```

**Without a cable:** copy `SessionSwitcher.apk` to the phone (USB file transfer, Google Drive, a
chat message to yourself, etc.) and tap it. Android will ask you to allow that app (Files, Drive,
Chrome...) to *install unknown apps*. Allow it and tap Install. Play Protect may warn that it
doesn't recognize the developer. Choose "Install anyway".

If an install fails with "App not installed", an older copy signed with a different key is probably
still on the phone. Uninstall it first.

## Pairing

1. On the PC, open Session Switcher and go to **Setup → Phone access**. Turn it on, then tap **Pair a phone**.
   The PC shows its address (for example `192.168.1.20:4788` or `mypc.tailnet.ts.net:4788`) and
   an 8-character code.
2. In the app, enter the address and code and tap **Connect**.
3. The app checks `http://<addr>/hello`, saves the address, then opens
   `http://<addr>/pair?code=<CODE>&name=<device name>`. The PC sets a long-lived cookie and
   redirects to `/`. From then on, opening the app goes straight to the PC.

If the PC can't be reached (it's off, Phone access is disabled, or the phone is on another
network), the app returns to the connect screen with a **Retry** button. Session Switcher's
settings can call `Android.disconnect()` to forget the PC and clear the cookie.

## How the app talks to the server

- Start URL: `http://<saved server>/`. Without a saved server it loads the bundled `assets/connect.html`.
- `GET /hello` returns JSON `{ app: "session-switcher", version, paired }` with
  `Access-Control-Allow-Origin: *`. The connect page fetches it from a `file://` origin. If that
  fetch fails, the page navigates anyway.
- `GET /pair?code=&name=` sets the auth cookie and redirects (302) to `/`. On failure it should
  return a readable HTML error page. The user can press Back to get to the connect screen.
- User agent ends with ` SessionSwitcherAndroid/5.0`. `window.Android.isApp()` returns `true`.
- JS bridge `window.Android`: `saveServer(addr)`, `getServer()`, `deviceName()`, `disconnect()`,
  `isApp()`, `share(text)`, `openExternal(url)` (http/https only).
- Back button: the app calls `window.__mobileBack()` if it exists. A truthy return means the page
  handled Back (closed a sheet, went up a level). Otherwise the app goes back in WebView history,
  or sends the app to the background.
- Links to hosts other than the saved server's host open in the phone's browser.
- `<input type="file" accept="image/*" multiple>` opens the system picker and supports multiple
  selection.
