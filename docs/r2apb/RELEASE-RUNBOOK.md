# Runbook انتشار، kill switch و rollback — R2a-PB (فقط دستورالعمل؛ اجرا نشده)

**این سند اجرا نشده است و مجوز اجرا نیست.** بخش های ۱ تا ۶ (کد، فایل ها، واحد و Nginx؛ همه با Beta خاموش) فقط پس از متن صریح مالک `PRODUCTION_DEPLOY_GO` اجرا می شوند. بخش های ۷ و ۸ (فعال سازی برای کاربران) تأیید جداگانه مالک می خواهند (تصمیم D6 گزارش Go/No-Go). هر مرحله با شرط توقف، با اولین شکست متوقف و طبق بخش ۱۰ برگردانده می شود، نه با ادامه دادن. هیچ بخشی از این سند بدون تغییر در Production و بدون rollback آماده، اجرا نمی شود.

نمادها: `$PF` پوشه کار خصوصی (`/root/.hermes/cache/scratch/pb/preflight`)، `$CK` پوشه snapshot خصوصی همین استقرار، `$REPO=/root/projects/besrah-r2apb`.

آنچه تمرین شده: همه فرمان های overlay (plan/apply/verify/rollback) روی **کپی** `/srv/besrah`؛ واحد گذرا با sandbox معادل؛ Nginx جداگانه با گواهی واقعی؛ `nginx -t` روی کپی کل پیکربندی. هیچ کدام روی Production اجرا نشده اند. زمان restart اندازه گیری شده روی نمونه معادل: حدود **۰.۷ ثانیه** (stop + start + listen).

## ۰. پیش شرط ها (همه باید ✔ باشند)

- [ ] متن GO مالک: `PRODUCTION_DEPLOY_GO` + تصمیم های D1 تا D6.
- [ ] `git -C $REPO status --porcelain` خالی؛ `git rev-parse HEAD` = commit تأییدشده در پیام GO.
- [ ] آزمون ها روی همان HEAD سبز (آخرین نتیجه: `evidence/regression-summary.txt`).
- [ ] دیسک: `df -h /` حداقل ۳GB آزاد (در Go/No-Go ۶.۸GB، ۸۳٪ پر بود).
- [ ] هیچ استقرار/restart دیگری برای `besrah-core` در حال انجام نیست؛ بات و بسفود (سرویس های دیگر) را دست نزنید.
- [ ] پنجره کم ترافیک؛ حداکثر ۲ restart ≈ ۰.۷ ثانیه ای. سقف `StartLimitBurst` پیش فرض systemd (۵ شروع در ۱۰ ثانیه) را رعایت کنید؛ restart ها را پشت سر هم و سریع نزنید.

## ۱. build تمیز و plan (روی همین سرور، بدون لمس Production)

```bash
cd $REPO && git rev-parse HEAD
export PF=/root/.hermes/cache/scratch/pb/preflight
rm -rf $PF/export-HEAD && mkdir -p $PF/export-HEAD
git archive HEAD | tar -x -C $PF/export-HEAD
ln -s $REPO/packages/core/node_modules $PF/export-HEAD/packages/core/node_modules   # بدون dependency جدید
(cd $PF/export-HEAD/packages/core && npx tsc -p tsconfig.build.json)
diff -rq $PF/export-HEAD/packages/core/dist $REPO/packages/core/dist && echo "dist == worktree"
git diff --name-only --diff-filter=AMR 8e8e278..HEAD -- apps/miniapp \
  | python3 -c "import sys,json;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" > $PF/assets.json
python3 scripts/preflight_overlay.py plan --candidate $PF/export-HEAD --production /srv/besrah \
  --base-dist $PF/export-8e8e278/packages/core/dist --base-assets-json $PF/assets.json --note "R2a-PB $(git rev-parse --short HEAD)" --out $PF/plan.json
```

(`$PF/export-8e8e278` همان export تمیز commit مبنا `8e8e278` است که `scripts/preflight_stage.sh` می سازد؛ آن اسکریپت همه این مراحل را روی **کپی** `/srv/besrah` اجرا می کند و مرجع تمرین است.)

بازبینی plan: دقیقاً **۳۶ فایل** برای commit فعلی (۳۱ dist + ۵ asset)، `views/food.js` و `assets/bus-guide.json` فقط در `excludedDrift`، هیچ فایل تست یا `data/bus`. هر تفاوتی ⇒ توقف و گزارش.

## ۲. snapshot (قبل از هر نوشتن)

```bash
export CK=/var/backups/besrah/pb-deploy-$(date -u +%Y%m%dT%H%M%SZ); install -d -m 700 $CK
tar -C /srv -czf $CK/srv-besrah-before.tar.gz besrah && sha256sum $CK/srv-besrah-before.tar.gz > $CK/srv-besrah-before.sha256
cp -a /etc/systemd/system/besrah-core.service $CK/
cp -a /etc/systemd/system/besrah-core.service.d $CK/ 2>/dev/null || true
cp -a /etc/nginx/snippets/besrah-miniapp-root.conf /etc/nginx/sites-enabled/besrah.arklyn.ir.conf $CK/
nginx -T > $CK/nginx-T-before.txt 2>&1
systemctl show besrah-core -p MainPID -p NRestarts -p MemoryCurrent -p MemoryMax -p MemorySwapMax -p ActiveState > $CK/unit-before.txt
python3 scripts/release_inventory.py create --source-root $REPO --production-root /srv/besrah --output $CK/manifest-before.json
python3 scripts/preflight_api_regression.py record --base http://127.0.0.1:3080 --out $CK/api-before.json
cp $PF/plan.json $CK/plan.json
# بازیابی آزمایی: tar را در پوشه موقت باز کنید و hash ها را با $CK/manifest-before.json مقایسه کنید
```

شرط توقف: خطا در هر دستور، یا `api-before.json` کمتر از ۱۳۰ مسیر.

## ۳. مرحله A — کد با flag خاموش (نیاز به GO)

```bash
python3 scripts/preflight_overlay.py apply --plan $CK/plan.json --candidate $PF/export-HEAD --target /srv/besrah --snapshot $CK/overlay-snapshot --group dist
systemctl restart besrah-core
sleep 2; systemctl is-active besrah-core; systemctl show besrah-core -p NRestarts -p MainPID
curl -s http://127.0.0.1:3080/health; curl -s http://127.0.0.1:3080/app/api/beta; echo
```

انتظار: `active`، `NRestarts=0`، `/app/api/beta` ⇒ `enabled:false`، `/app/api/journey?...` ⇒ ۴۰۴. شرط توقف: هر مورد دیگر ⇒ بخش ۱۰ (rollback کد).

## ۴. مرحله B — فایل های Mini App (بعد از A؛ `views/metro.js` آخرین است)

```bash
python3 scripts/preflight_overlay.py apply --plan $CK/plan.json --candidate $PF/export-HEAD --target /srv/besrah --snapshot $CK/overlay-snapshot --group assets
python3 scripts/preflight_overlay.py verify --plan $CK/plan.json --target /srv/besrah --state post
python3 - <<'EOF' > $PF/expected-changed.json
import json;print(json.dumps(['/app/api.js','/app/app.css','/app/journey.js','/app/ui/planner.js','/app/views/metro.js']))
EOF
python3 scripts/preflight_api_regression.py compare --base http://127.0.0.1:3080 --file $CK/api-before.json --expect-changed $PF/expected-changed.json
```

انتظار: `UNEXPECTED 0`، تغییر مورد انتظار دقیقاً ۵. در مرورگر عادی (بدون `?beta=1`) صفحه مترو **هیچ کارت Beta** ندارد و تابلو سالم است. این ایمن ترین توقف نقطه ای است: کد مستقر، کاربران چیزی تازه نمی بینند.

## ۵. مرحله C — حالت و کنترل (نیاز به GO؛ هنوز Beta خاموش)

۱. پوشه کنترل با مسیر **غیر** `/etc/besrah` (آن پوشه `0700` است و DynamicUser نمی تواند بخواند):

```bash
install -d -m 755 -o root -g root /etc/besrah-journey
printf '{"schemaVersion":1,"enabled":false,"feedbackEnabled":false,"rolloutPercent":0}\n' > /etc/besrah-journey/control.json.tmp
chmod 644 /etc/besrah-journey/control.json.tmp && chown root:root /etc/besrah-journey/control.json.tmp
mv /etc/besrah-journey/control.json.tmp /etc/besrah-journey/control.json   # جایگزینی اتمیک
```

۲. drop-in واحد (فایل کامل؛ هیچ مقدار محرمانه ندارد):

```ini
# /etc/systemd/system/besrah-core.service.d/journey-beta.conf
[Service]
StateDirectory=besrah-feedback
StateDirectoryMode=0700
Environment=BESRAH_JOURNEY_BETA=on
Environment=BESRAH_JOURNEY_SWITCH_FILE=/etc/besrah-journey/control.json
Environment=BESRAH_FEEDBACK_DIR=/var/lib/besrah-feedback/feedback
Environment=BESRAH_ALLOWED_ORIGINS=https://besrah.arklyn.ir
Environment=BESRAH_JOURNEY_CALENDAR=weekday_baseline
```

۳. اعمال و بررسی:

```bash
systemd-analyze verify besrah-core.service
systemctl daemon-reload && systemctl restart besrah-core
sleep 2; systemctl is-active besrah-core
curl -s http://127.0.0.1:3080/app/api/beta        # enabled:false (فایل کنترل خاموش است)
stat -c '%a %U' /var/lib/private/besrah-feedback   # 700 و کاربر پویای سرویس
```

شرط توقف: سرویس بالا نیامد یا `NRestarts>0`: `rm /etc/systemd/system/besrah-core.service.d/journey-beta.conf && systemctl daemon-reload && systemctl restart besrah-core` و سپس بخش ۱۰.

## ۶. مرحله D — fragment Nginx (نیاز به GO؛ فقط POST دقیق)

```bash
cp /etc/nginx/snippets/besrah-miniapp-root.conf $CK/snippet-before.conf
python3 - <<'EOF'
p='/etc/nginx/snippets/besrah-miniapp-root.conf'
s=open(p).read()
frag=open('/root/projects/besrah-r2apb/docs/r2a-pb/nginx-feedback-route.conf').read()
assert 'location = /api/journey-feedback' not in s
marker='location ^~ /api/ {'
assert s.count(marker)==1
open(p,'w').write(s.replace(marker, frag.rstrip()+'\n\n'+marker))
EOF
nginx -t && nginx -s reload
```

اگر `nginx -t` شکست خورد: `cp $CK/snippet-before.conf /etc/nginx/snippets/besrah-miniapp-root.conf` و دوباره `nginx -t`؛ reload نکنید.

smoke لبه روی نام واقعی (هیچ داده ای ثبت نمی کند):

```bash
H=https://besrah.arklyn.ir
curl -s -o /dev/null -w "POST /api/beta (403) %{http_code}\n" -X POST -d '{}' $H/api/beta
curl -s -o /dev/null -w "GET feedback (403) %{http_code}\n" $H/api/journey-feedback
curl -s -o /dev/null -w "POST feedback sub-path (403) %{http_code}\n" -X POST -d '{}' $H/api/journey-feedback/x
curl -s -o /dev/null -w "POST with query (400) %{http_code}\n" -X POST -d '{}' "$H/api/journey-feedback?token=x"
curl -s -o /dev/null -w "POST >4KiB (413) %{http_code}\n" -X POST -H 'content-type: application/json' --data-binary "$(head -c 5000 /dev/zero | tr '\0' x)" $H/api/journey-feedback
curl -s -o /dev/null -w "POST no header (disabled => 404) %{http_code}\n" -X POST -H 'content-type: application/json' -d '{}' $H/api/journey-feedback
```

انتظار: ۴۰۳، ۴۰۳، ۴۰۳، ۴۰۰، ۴۱۳، و ۴۰۴ تا وقتی beta خاموش است.

## ۷. مرحله E — پنجره «آزمون گوشی»، بدون بازخورد (نیاز به تأیید جدا)

**این لحظه Beta برای همه بازدیدکنندگان قابل ورود اختیاری است** (D1). زمان شروع و پایان را ثبت کنید.

```bash
printf '{"schemaVersion":1,"enabled":true,"feedbackEnabled":false,"rolloutPercent":0}\n' > /etc/besrah-journey/control.json.tmp \
  && chmod 644 /etc/besrah-journey/control.json.tmp && mv /etc/besrah-journey/control.json.tmp /etc/besrah-journey/control.json
curl -s http://127.0.0.1:3080/app/api/beta
python3 scripts/beta_probe.py once            # باید OK؛ WARN ناشی از «بدون نمونه موفق» بعد از روشن شدن نباید باشد
```

سپس مالک/آزمونگر `DEVICE-WEBVIEW-QA-FA.md` را اجرا می کند. اگر FAIL شد: kill switch سطح ۱ (بخش ۹)، رفع، بازگشت به مرحله قبل.

## ۸. مرحله F — باز کردن بازخورد و گسترش (فقط پس از PASS گوشی)

1. smoke نوشتن با شناسه `SYNTH-` تا در گزارش ها شمرده نشود (آزمون شده: `synthetic_excluded=1`):

```bash
printf '{"schemaVersion":1,"enabled":true,"feedbackEnabled":true,"rolloutPercent":0}\n' > /etc/besrah-journey/control.json.tmp && chmod 644 /etc/besrah-journey/control.json.tmp && mv /etc/besrah-journey/control.json.tmp /etc/besrah-journey/control.json
MV=$(curl -s "http://127.0.0.1:3080/app/api/journey?line=1&from=METRO-107&to=METRO-108" | python3 -c "import sys,json;print(json.load(sys.stdin)['modelVersion'])")
TODAY=$(TZ=Asia/Tehran date +%F)
curl -s -w "\nHTTP %{http_code}\n" -X POST https://besrah.arklyn.ir/api/journey-feedback \
  -H 'content-type: application/json' -H 'x-besrah-beta: 1' -H 'origin: https://besrah.arklyn.ir' \
  -d "{\"v\":1,\"reportId\":\"SYNTH-deploy-$(date -u +%Y%m%d%H%M)-001\",\"kind\":\"timing_quality\",\"timingQuality\":\"close\",\"consent\":{\"storeForModelImprovement\":true},\"modelVersion\":\"$MV\",\"context\":{\"line\":1,\"originId\":\"METRO-107\",\"destinationId\":\"METRO-108\",\"serviceDate\":\"$TODAY\"}}"
ls -la /var/lib/private/besrah-feedback/feedback     # فایل ۰۶۰۰، پوشه ۰۷۰۰، قفل موجود
```

انتظار: `201`. همان درخواست دوباره ⇒ `200 duplicate`. بازخوردی که آزمونگر در مرحله E با گوشی فرستاده، بازخورد واقعی ناشناس محسوب می شود؛ زمان آن را برای QC یادداشت کنید.

2. گسترش تدریجی (بعد از هر مرحله حداقل یک بازه پایش و بازبینی مالک): `rolloutPercent` را ۰ ⇒ ۱۰ ⇒ ۲۵ ⇒ حداکثر ۱۰۰ بگذارید. این عدد فقط **برجسته سازی** در UI است، نه محدودیت دسترسی و نه ظرفیت. rate limit ثابت می ماند و افزایش آن نیاز به کار جدا دارد.

## ۹. پایش ۲۴ ساعت اول و kill switch

اجرا (در پس زمینه، فایل خروجی ۰۶۰۰ و بدون payload یا IP):

```bash
python3 scripts/beta_probe.py watch --minutes 1440 --interval 60 --out $CK/probe-24h.jsonl   # کد خروج 0=OK، 10=WARN، 20=KILL
```

آستانه ها ثابت و از `PERFORMANCE-BUDGET.md` گرفته شده اند (تغییرشان نیاز به تصمیم جدید مالک دارد):

| شاخص | WARN | KILL (اقدام: سطح ۱) |
|---|---|---|
| p95 برنامه ریز (۵ نمونه بعد از warm-up) | ≥ ۸۰ms | ≥ ۲۵۰ms |
| p95 API قدیمی `/app/api/trains` | ≥ ۵۰ms | ≥ ۱۵۰ms |
| حافظه واحد (`MemoryCurrent`) | ≥ ۱۵۰MiB | ≥ ۱۷۵MiB (سقف ۱۹۲) |
| پاسخ ۵xx در یک نمونه | ۱ | ≥ ۲ |
| restart واحد، `Result≠success`، `oom_kill>0` | | هر کدام |
| پوشه بازخورد | ≥ ۶MiB | ≥ ۷.۵MiB (سقف ۸) |
| دیسک `/` آزاد | ≤ ۱GiB | ≤ ۲۵۶MiB |
| قفل مانده (PID قفل ≠ MainPID) | WARN: بخش ۱۲-الف | |
| هیچ پاسخ ۲۰۰ برنامه ریز (مثلاً 429) | WARN «ناتمام» | |

علاوه بر پروب، تا ۲۴ ساعت: `systemctl show besrah-core -p NRestarts -p Result`، `journalctl -u besrah-core -p err --since …`، و نمونه دستی تابلو/ردیاب/بسفود. هر رگرسیون تابلو، OOM، رشد حافظه یا نشت داده ⇒ سطح ۱ و توقف گسترش. ۴۲۹ در burst قابل قبول است؛ اشباع مداوم فقط توقف گسترش است، نه افزایش منابع. توجه: event loop در Production قابل اندازه گیری نیست (بدون instrumentation)؛ پروکسی آن latency API قدیمی است.

### kill switch (بدون restart)

- **سطح ۰ — فقط بازخورد:** `{"schemaVersion":1,"enabled":true,"feedbackEnabled":false,"rolloutPercent":P}`؛ ثبت بازخورد ⇒ ۵۰۳، برنامه ریز کار می کند.
- **سطح ۱ — کل Beta:** `{"schemaVersion":1,"enabled":false,"feedbackEnabled":false,"rolloutPercent":0}`؛ journey و feedback هر دو ⇒ ۴۰۴ هم زمان با درخواست بعدی، تابلو و بسفود دست نمی خورند، کارت برای کسانی که opt-in نکرده اند محو می شود. آزموده شده (K1/K2: همان PID، بدون restart).
- هر فایل خراب/حذف شده/قابل نوشتن برای دیگران ⇒ خودکار سطح ۱ (K3 تا K5).
- نوشتن همیشه با `mv` اتمیک از فایل `.tmp` همان پوشه.

## ۱۰. rollback کامل

ترتیب معکوس، با تأیید پس از هر گام:

1. **سطح ۱ kill switch** (فوری، بدون restart).
2. **Nginx:** `cp $CK/snippet-before.conf /etc/nginx/snippets/besrah-miniapp-root.conf && nginx -t && nginx -s reload`؛ بررسی: `POST /api/journey-feedback` ⇒ ۴۰۳.
3. **drop-in واحد:** `rm /etc/systemd/system/besrah-core.service.d/journey-beta.conf && systemctl daemon-reload` (restart در گام ۴).
4. **کد و asset ها:**

```bash
python3 scripts/preflight_overlay.py rollback --plan $CK/plan.json --target /srv/besrah --snapshot $CK/overlay-snapshot
systemctl restart besrah-core
python3 scripts/release_inventory.py validate --source-root $REPO --production-root /srv/besrah --manifest $CK/manifest-before.json
python3 scripts/preflight_api_regression.py compare --base http://127.0.0.1:3080 --file $CK/api-before.json    # باید UNEXPECTED 0 و 133/133
```

   اگر `rollback` فایلی را در وضعیت ناشناخته دید، **متوقف می شود**؛ فقط با تصمیم انسانی از `--force` یا از `$CK/srv-besrah-before.tar.gz` استفاده کنید.
5. **داده بازخورد:** `/var/lib/private/besrah-feedback` را **حذف نکنید**. rollback کد، شواهد و گزارش های ثبت شده را تخریب نمی کند. قبل از هر کار روی آن writer باید بسته باشد (سرویس متوقف یا کنترل سطح ۱)، سپس یک کپی خصوصی بگیرید.
6. تأیید: `systemctl is-active besrah-core`، `NRestarts`، `/app/api/beta` ⇒ `enabled:false`، مقایسه با `unit-before.txt`، و سلامت ردیاب/تابلو/بسفود.

## ۱۱. روند شکست در حین استقرار

| نشانه | اقدام |
|---|---|
| `apply` رد شد (`REFUSED`) | هیچ فایلی عوض نشده؛ علت drift را پیدا کنید؛ plan را دوباره بسازید؛ ادامه ندهید |
| سرویس بعد از restart بالا نیامد | `journalctl -u besrah-core -n 50`؛ rollback کد (گام ۴) و restart؛ اگر drop-in بود ابتدا گام ۳ |
| `/app/api/beta` پاسخ نمی دهد | rollback کد |
| API قدیمی مقایسه ناخواسته نشان داد | rollback کد؛ مقایسه دوباره |
| `nginx -t` شکست خورد | بازگرداندن snippet؛ reload نکنید |
| حافظه > ۱۷۵MiB یا OOM | سطح ۱، سپس بررسی؛ در صورت تکرار rollback کد |

## ۱۲. روندهای عملیاتی

### الف) قفل مانده بعد از crash/OOM/kill (feedback ⇒ ۵۰۳، برنامه ریز سالم)

نشانه: پروب WARN «قفل متعلق به process مرده»؛ یا `journalctl` وجود `signal=KILL`/`oom-kill`. در restart **عادی** قفل آزاد می شود (آزموده شده).

```bash
D=/var/lib/private/besrah-feedback/feedback
cat $D/.feedback.lock                       # pid:uuid
systemctl show besrah-core -p MainPID --value
# اگر pid داخل قفل با MainPID فعلی برابر نیست و process آن وجود ندارد:
```

۱. kill switch سطح ۰ (بسته شدن writer)؛ ۲. `systemctl stop besrah-core`؛ ۳. با `stat` و انتهای فایل `feedback-YYYY-MM.jsonl` (`tail -c 200`) بررسی کنید که خط ناقص نیست (اگر هست، بند ب)؛ ۴. `rm $D/.feedback.lock`؛ ۵. `systemctl start besrah-core`؛ ۶. smoke با شناسه `SYNTH-`. **هرگز** قفل را بدون توقف سرویس حذف نکنید.

### ب) دم ناقص یا فایل خراب (ENOSPC، قطع برق، kill وسط نوشتن)

store فایل را fail-closed می بندد. بعد از آزاد کردن دیسک و توقف سرویس: از فایل یک کپی خصوصی بگیرید؛ آخرین خط بدون `\n` را با `truncate` به آخرین `\n` سالم برگردانید (مقایسه تعداد خطوط با گزارش `beta_feedback_report.py report --strict`)؛ قفل را طبق (الف) حذف و سرویس را start کنید. هیچ رکورد ACK شده ای نباید گم شود؛ رکوردی که ACK نشده (۵۰۳ گرفته) ممکن است ناقص باشد و دور ریخته می شود. (آزموده: ENOSPC ⇒ ۴۶ رکورد `201` برابر ۴۶ خط پایدار و یک دم ناقص.)

### پ) دیسک رو به پر شدن

پروب WARN ≤ ۱GiB. اول فضای غیر مرتبط را آزاد کنید (لاگ/backup قدیمی با تأیید مالک)؛ سقف store ۸MiB است و رشد آن را محدود می کند.

### ت) سوء استفاده یا اسپم

سطح ۰ برای قطع نوشتن؛ rate limit و سقف روزانه ۲۰۰۰ تعریف شده اند؛ سقف پر ⇒ ۵۰۳ `feedback_full` و برنامه ریز بی اثر. بازبینی `rejections-YYYY-MM.json` (فقط کد های تجمیعی، بدون بدنه). IP ذخیره نمی شود؛ مسدودسازی IP در Nginx (جدا و با تأیید) ممکن است.

## ۱۳. retention و پشتیبان بازخورد (دستی، تا تصمیم مالک درباره cron)

هیچ cron خودکار نصب نشده. ماهانه، با مجوز مالک:

```bash
# snapshot خصوصی بدون writer فعال (kill switch سطح ۰ یا توقف کوتاه)، سپس:
python3 scripts/beta_feedback_report.py report --dir $SNAPSHOT --strict --md $OUT/report.md --json $OUT/report.json
python3 scripts/beta_feedback_report.py purge --dir $SNAPSHOT --today $(TZ=UTC date +%F)            # dry-run
python3 scripts/beta_feedback_report.py purge --dir $SNAPSHOT --today $(TZ=UTC date +%F) --apply --out-dir $OUT/retained-store
```

snapshot تحلیلی جایگزین مستقیم پوشه runtime نیست؛ ترفیع آن طبق `FEEDBACK-OPERATIONS.md` کار جدا و آفلاین مالک است. حذف از backup های قدیمی هم عملیات مستقل است. بازخورد ناشناس قابل انتساب به شخص نیست و حذف فردی ممکن نیست (UI هم همین را می گوید).

## ۱۴. بازگشت به حالت پیش از Beta (کامل)

سطح ۱ ⇒ Nginx ⇒ drop-in ⇒ rollback overlay ⇒ restart ⇒ تأیید. فایل کنترل و `/etc/besrah-journey` بی ضرر هستند و می توانند بمانند. پوشه `/var/lib/private/besrah-feedback` تا تصمیم مالک درباره نگهداری/حذف داده، دست نخورده می ماند.
