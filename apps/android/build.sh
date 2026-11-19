#!/usr/bin/env bash
# Gradle-free build of the Besrah Android shell: aapt2 + javac + d8 + zipalign + apksigner (Android SDK 34, JDK 17).
# The signing keystore is NOT in the repository: pass KEYSTORE / KS_PASS, or a local debug keystore is created outside it.
set -euo pipefail
SDK="${ANDROID_SDK:-/root/android-sdk}"; BT="$SDK/build-tools/34.0.0"; JAR="$SDK/platforms/android-34/android.jar"
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="${OUT:-$HERE/build}"
KEYSTORE="${KEYSTORE:-$HOME/.besrah-android/debug.keystore}"; KS_PASS="${KS_PASS:-}"
rm -rf "$OUT"; mkdir -p "$OUT"/{res,gen,classes,dex}
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res/compiled.zip"
"$BT/aapt2" link -I "$JAR" --manifest "$HERE/AndroidManifest.xml" -o "$OUT/base.apk" --java "$OUT/gen" "$OUT/res/compiled.zip" --min-sdk-version 26 --target-sdk-version 34
javac -source 17 -target 17 -Xlint:-options -encoding UTF-8 -classpath "$JAR" -d "$OUT/classes" $(find "$HERE/src" "$OUT/gen" -name '*.java')
"$BT/d8" --lib "$JAR" --min-api 26 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
cp "$OUT/base.apk" "$OUT/unsigned.apk"
python3 -c 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"a",zipfile.ZIP_DEFLATED); z.write(sys.argv[2],"classes.dex"); z.close()' "$OUT/unsigned.apk" "$OUT/dex/classes.dex"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"; chmod 700 "$(dirname "$KEYSTORE")"
  KS_PASS="${KS_PASS:-$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)}"
  keytool -genkeypair -keystore "$KEYSTORE" -alias besrah -keyalg RSA -keysize 3072 -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Besrah, O=Arklyn, C=IR" >/dev/null 2>&1
  printf '%s\n' "$KS_PASS" > "$(dirname "$KEYSTORE")/debug.keystore.pass"; chmod 600 "$KEYSTORE" "$(dirname "$KEYSTORE")/debug.keystore.pass"
fi
KS_PASS="${KS_PASS:-$(cat "$(dirname "$KEYSTORE")/debug.keystore.pass")}"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias besrah --ks-pass "pass:$KS_PASS" --out "$OUT/besrah.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT/besrah.apk" | head -3
ls -la "$OUT/besrah.apk"
