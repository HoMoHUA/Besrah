# NET01-QG | گزارش تکمیل Quality Gate

تاریخ: ۲۰۲۶-۱۱-۰۴. شاخه: `feature/net01-qg` (worktree `/root/projects/besrah-net01-qg`).
وضعیت: **`READY_FOR_R3C_PLANNING`**، مشروط به دو تصمیم/آزمون خارج از دسترس Hermes (بخش ۷). این **نه** `PRODUCTION_DEPLOY_GO` است و نه `PRODUCTION_BETA_FEEDBACK_GO`.

## ۱) خط مبنا و حفاظت

- `main` @ `3b3dbd3` (۲۷ فایل کثیف از پیش، دست نخورد)، `feature/r3b-product-ux` @ `9d5b3a1`، NET01 @ `b8e9f41` (فرزند R3-B، اثبات شد با `merge-base --is-ancestor`)، QG روی همان.
- Production زنده: `enabled:false`، `feedbackEnabled:false`، `rolloutPercent:0`؛ `besrah-core` فعال با `NRestarts=0`؛ dist Production برابر build تمیز `587accb` (بایت به بایت، `engine/service/server.js`) و فاقد `timetable-*.js`.
- checkpoint: `/var/backups/besrah/net01qg-20261104T084257Z/` (bundle، tar منبع، SHA256SUMS، `protected-before.json`، mode 0700). worktree R3-B و NET01 قدیمی دست نخورد؛ سه فایل تصادفی بی ربط (نام PID) از ریشهٔ NET01 به scratch منتقل شد، حذف نشد.
- به `/srv/besrah`، Nginx، systemd، فایل کنترل، `network.json`، داده خام و بات ها دست زده نشد. هیچ deploy، restart، flag یا merge نبود.

## ۲) آنچه P0 بود و چه شد

| P0 | نتیجه | شاهد |
|---|---|---|
| آزمون HTTP ۷ از ۸ | **۸ از ۸ با دو سرور واقعی.** بدون سرور مبنا آزمون اکنون FAIL «BLOCKED» می شود. دلیل شکست قبلی (سرور مبنا نبود) اثبات شد؛ هیچ assertion ای حذف نشد، قرارداد صریح شد | `tests/r3a/test_preview_http.py`، `BASELINE-VS-CANDIDATE-HTTP.json` |
| parity سراسری | ۱۸۶۸ درخواست، ۳ سرور (مبنا `587accb`، candidate، دوقلوی بدون overlay)، **۰ تخلف**. خطا/پنجشنبه/جمعه/خط ۲/استاتیک تغییری ندارند. mutation (+۶۰ ثانیه فاز B پنجشنبه) با ۱۱۷ تخلف **کشته شد** | همان JSON + `evidence/parity-mutation-*.json` |
| `event_id` | ثابت و یکتا (۲۲۰ سفر روز)، وابسته به نسخهٔ مدل؛ **Mini App آن را نمی خواند، فقط حمل می کند** | `overlay.test.ts`، `oracle.test.ts`، grep روی `apps/` |
| fallback بی صدا | حالا آشکار: یادداشت، `timetableNotice`، `/app/api/beta`، هویت مدل جدا. ۱۸۶۸ از ۱۸۶۸ پاسخ HTTP بررسی شد (نبود=۰، نشت=۰، مثبت کاذب=۰) | `degraded.test.ts` (RED ۵ شکست ← GREEN) |
| وابستگی اجرا به فایل شاهد | **باگ جدی طراحی یافت و رفع شد:** نبود یک PNG کل overlay را رد می کرد. اکنون فقط ورودی `runtime` | `data-provenance.test.ts` |
| ۲۰ اسلات جذب شده | قاعدهٔ تخصیص است؛ جدول کامل با فاصلهٔ ۰ یا ۶۰ ثانیه | `model-lineage.json` |
| برگشت (یافتهٔ جدید) | overlay نسخهٔ اول جهت برگشت را بدتر کرده بود (۴۶ ← ۲۲۰ جفت نزدیک). با جست وجوی کامل فاز به **۶۶** رسید و رفت **۰**؛ سه جفت باقی مانده در آزمون ثبت شد | `phase-search.test.ts`، `known-artefacts.test.ts` |
| داده (dwell، ۱۴ ردیف، ۴۹/۵۰، املا) | مصرف کننده ندارد؛ با آزمون ثابت شد. ۴۹/۵۰ **قابل بازتولید نیست** (خروجی خام اپراتور در بسته نیست) | `ISSUE-LEDGER.md` |

## ۳) آزمون های واقعی این نوبت (روی HEAD کد `91ea16c`)

- `tsc --noEmit`: موفق. `build`: موفق. `git diff --check`: موفق. `build_bus_app_data.py --check`: موفق.
- Core Vitest: **۵۶۴ از ۵۶۴** (۴۶ فایل؛ ۵۸ آزمون از آن در `tests/net01` است و همگی در این نوبت نوشته شدند).
- Mini App: **۱۸۱ از ۱۸۱**. n8n: **۲۱ از ۲۱**. release (JS): **۳ از ۳**. Python data: **۱۶۷**. Python release: **۲۰**. HTTP (`tests/r3a`): **۸ از ۸**.
- **اثبات آزمون های جدید واقعاً حساس اند:** `degraded` RED→GREEN؛ `test_08` RED(BLOCKED)→GREEN؛ oracle با تغییر ۱ ثانیه ای offset دو آزمون را شکست؛ harness HTTP با تغییر فاز پنجشنبه شکست خورد.
- benchmark (cgroup ۱۹۲ MiB، بدون swap، ۱۰۰ نمونه): `WITHIN_BUDGETS` برای هر دو؛ اوج cgroup ۱۵۰٫۴ در برابر ۱۴۷٫۲ MiB مبنا.
- دودی مرورگر واقعی روی UI R3-B با داده NET01 (۳۹۰×۸۴۴): کارت ها بدون تکرار (۱۲:۵۱ غدیر، ۱۲:۵۹ غدیر، ۱۳:۰۷ فرودگاه)، هشدار ثابت دیده شد، بدون overflow. UI بدون هیچ تغییر است، پس ماتریس تصویری کامل لازم نبود.
- fingerprint محافظت: `protected_changes []` (بخش ۶).

## ۴) تغییر واقعی برای کاربر

مدل روز عادی خط ۱ اکنون ۱۱۰ حرکت خروجی دارد (نه ۱۰۱): A=۷۸، B=۳۲. **این فقط رفع برخورد نیست**؛ ریتم ۱۱:۵۵ تا ۱۹:۱۵ برون یابی شده است (`QG-010`): حدود ۹ درصد حرکت خروجی بیشتر (۱۰۱ ← ۱۱۰) و مثلاً ساعت ۱۲ از ۴ به ۶ حرکت A. ساختار هشدار «تخمینی» دست نخورده و هیچ ضریب اطمینان تازه ای ساخته نشد.

## ۵) خطرهای واقعی باقی مانده

۱. **QG-010:** ریتم عصر برون یابی است و حدود ۹ درصد حرکت بیشتر نشان می دهد. نیاز به تصمیم مالک (راه جایگزین کم خطر: فقط ۳۲ ردیف B + جداسازی فاز، با ریتم مبنا).
۲. **QG-013:** در ۳ بازهٔ برگشت (حدود ۰۷:۳۹، ۰۹:۰۷، ۲۰:۴۲) ممکن است دو کارت با یک دقیقه دیده شود؛ یکی ۱ ثانیه ای مربوط به A **مشاهده شده**.
۳. ۱۸ دقیقهٔ کوثر تا وکیل آباد از **یک** جفت برازش شد و هماهنگی آن با شبکهٔ ۸ دقیقه ای مستقل نیست.
۴. صبح، ظهر و روزهای دیگر مشاهده نشده اند.
۵. Telegram WebView واقعی و iOS آزموده نشده اند (`AWAITING_HUMAN`).
۶. event loop p95 در benchmark ۲۶٫۹ms در برابر بودجهٔ ۳۰؛ پایش پس از انتشار.

## ۶) حفاظت Production (شاهد)

`r3a_guard.py check` در برابر `protected-before.json` پیش از هر تغییر: **`protected_changes []`**. `network.json` برابر Production. هیچ فایل خارج از worktree جدید و scratch نوشته نشد (به جز checkpoint در `/var/backups/besrah`).

## ۷) شرط `READY_FOR_R3C_PLANNING` و چه چیزی باقی می ماند

برای **برنامه ریزی R3-C** کافی است. برای استقرار لازم است: (الف) تصمیم مالک دربارهٔ QG-010، (ب) QA انسانی Telegram WebView، (ج) `PRODUCTION_DEPLOY_GO` مستقل با plan هش دار (`R3C-PREFLIGHT-DELTA.md`).

## ۸) فرمان های بازتولید

```
cd packages/core && npx tsc -p tsconfig.build.json
scripts/net01/run_regression.sh /tmp/net01-regression.log          # پیش از آن سه پیش نمایش 18901-3 و سرور مبنا 18911 بالا باشند
# سه سرور parity (مبنا: git archive 587accb + build؛ دوقلو: همان کد بدون فایل overlay)
node scripts/net01/parity-server.mjs --root=<base> --port=18911
node scripts/net01/parity-server.mjs --root=<repo> --port=18912
node scripts/net01/parity-server.mjs --root=<twin> --port=18913
python3 scripts/net01/http_parity.py out.json
node scripts/net01/lineage.mjs --root=$PWD --out=lineage.json
node scripts/net01/station_proximity.mjs --root=$PWD --out=prox.json
node scripts/net01/phase_search.mjs $PWD am
systemd-run --wait --pipe --collect -p MemoryMax=192M -p MemorySwapMax=0 -p TasksMax=64 -E TMPDIR=<private> node scripts/benchmark-journey-beta.mjs 100
```
