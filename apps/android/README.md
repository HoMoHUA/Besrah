# Besrah Android shell (APK)

A thin, secure wrapper around https://besrah.arklyn.ir for Android and HarmonyOS 4.2 and earlier (which run APKs).
The web app stays the single source of product behaviour; the shell adds only what a browser cannot:

- **Trip in progress as a real notification:** "شروع این سفر" in the planner posts an ongoing notification with a
  countdown (chronometer) to departure, then to arrival, with a "پایان سفر" action. It ends by itself 15 minutes after
  arrival or after 8 hours. Times are the plan's estimates, and the text says so.
- **HarmonyOS 4.x capsule:** the same notification carries the Huawei live-notification extras (`notification.live.*`:
  capsule status/type/colour/icon, type, operation, event), the keys the built-in Screen Recorder (14.0.0.120) uses for
  its status-bar capsule. Whether a third-party app gets the capsule is decided by the phone; without it the notification
  still works everywhere. Only a real device can confirm.
- Native location permission for the page's existing "my location" taps; provider links open outside the app.

Security: the JavaScript bridge (`window.BesrahNative`) answers only while the loaded page is `https://besrah.arklyn.ir`;
no file or content access, no mixed content, no cleartext, no backup. Nothing is stored by the shell.

Build (no Gradle; Android SDK 34 + JDK 17): `./build.sh` → `build/besrah.apk`. The signing keystore is kept outside the
repository (`~/.besrah-android/`); set `KEYSTORE`/`KS_PASS` to sign with a release key.
