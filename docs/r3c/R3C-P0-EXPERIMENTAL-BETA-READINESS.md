# R3-C P0 | آمادگی Beta آزمایشی Production

تاریخ: ۲۰۲۶-۱۱-۰۴. شاخه: `feature/r3c-experimental-beta` (worktree `/root/projects/besrah-r3c`)، کد کاندید در `evidence/CODE-HEAD.txt`.

## نتیجه

**`READY_FOR_PERSONAL_PRODUCTION_BETA_GO`.** همهٔ P0 فنی سبز است. هیچ استقرار، restart، تغییر Nginx یا تغییر flag انجام نشد. برای اجرا یک `PRODUCTION_DEPLOY_GO` کوتاه لازم است (بخش ۸).

تصمیم محصولی `QG-010 = APPROVED_EXPERIMENTAL_EXTENDED` پذیرفته شد و باز نشد. مدل محافظه کارانه ساخته نشد. fallback به مولد پایه فقط ابزار استمرار هنگام خطای overlay است و برای کاربران Beta انتخاب نشده.

## ۱) خط مبنا و وضعیت واقعی Production

- زنجیره: R3-B `9d5b3a1` ← NET01 `b8e9f41` ← NET01-QG `7a26e2b` ← R3-C. اثبات با `merge-base --is-ancestor`. `main` کثیف است و لمس نشد (بدون reset، clean، rebase، merge، force push).
- checkpoint: `/var/backups/besrah/r3c-20261104T102404Z/` (bundle، `protected-before.json`، بستهٔ ورودی). نگهبان حفاظت پیش و پس از کار: `protected_changes []` (بخش ۶).
- Production زنده: build `587accb`، `besrah-core` فعال با `NRestarts=0`، `enabled:false`، `feedbackEnabled:false`، `rolloutPercent:0`. `/srv/besrah` بدون `timetable-overlay.js` و بدون `data/timetable/`.
- `network.json` و هیچ CSV خام تغییر نکرد.

## ۲) تفاوت کد نسبت به NET01-QG (۱۶ فایل، فقط همین ها)

| موضوع | فایل ها |
|---|---|
| اصلاح برچسب شاهد (حداقلی) | `engine.ts` (تابع `publicConfidence`)، `timetable-overlay.ts`، `timetable-registry.ts`، `journey-beta/source.ts`، `data/timetable/normal-day-overlay-v1.json` (+فیلد `observedServiceDates`)، `apps/miniapp/format.js` (+دو برچسب هشدار) |
| ابزار استقرار | `scripts/preflight_overlay.py` (گروه `data`، rollback هر واحد جدا، فایل های `test-support` ارسال نمی شوند)، `scripts/r3c/*` |
| آزمون | `tests/r3c/confidence-provenance.test.ts`، `tests/r3c/journey-oracle.test.ts`، اصلاح دو انتظار در `tests/net01/*`، `test_preflight_overlay.py`، `format.test.mjs` |

`apps/` نسبت به R3-B فقط دو فایل (`format.js` سه خط و آزمونش) تفاوت دارد؛ UX فشردهٔ R3-B، CTA مرئی، تب های «حرکت های ایستگاه / نمای خط / ایستگاه ها» و فونت AzarMehr دست نخورده اند.

## ۳) مدل (تطبیق با گزارش QG)

۱۰۱ ← ۱۱۰ حرکت خروجی، A=۷۸ و B=۳۲، ۳۲ زمان B از جدول چاپی منهای ۱۸ دقیقهٔ مشتق، ۲۰ اسلات جذب شده، صفر برخورد دقیق، جهت رفت صفر جفت نزدیک و سه گروه برگشت. همه با `evidence/model-lineage-r3c.json` بازتولید شد و با گزارش QG برابر است. مرز مشاهده/مشتق/برون یابی و برچسب میان تاریخ ها در `EXTENDED-MODEL-PROVENANCE.md`.

## ۴) آزمون ها روی همین HEAD کد

| مجموعه | نتیجه |
|---|---|
| `tsc`، build، `git diff --check`، `build_bus_app_data.py --check` | موفق |
| Core (Vitest، سری) | **۵۷۳ از ۵۷۳** (۴۸ فایل) |
| Mini App | **۱۸۱ از ۱۸۱** |
| n8n / release (JS) | ۲۱ از ۲۱ / ۳ از ۳ |
| Python data / release | ۱۶۷ / ۲۱ |
| HTTP `tests/r3a` (با سرور مبنای واقعی) | **۸ از ۸** |
| آزمون های جدید R3-C (`tests/r3c`) | ۹ از ۹ |

- **یک شکست گذرا، گزارش صادقانه:** در اولین اجرای کامل، آزمون قدیمی `hardening-route › does not release compute capacity…` (به `pause(100ms)` حساس است) یک بار 429 داد، چون میزبان هم زمان زیر بار بود. تنها اجرا سه بار سبز شد و اجرای کامل پایانی سبز بود. آزمون تغییر نکرد و ضعیف نشد. این یک آزمون حساس به زمان است نه رگرسیون این تغییر.
- حساسیت آزمون جدید `journey-oracle`: با تغییر ۱ ثانیه ای در انتظار، شکست خورد؛ سپس برگردانده شد.
- اوراکل مستقل برای event identity، ترتیب توقف، زمان انتظار، عبور روز خدمت (۲۳:۴۰)، ۲۰ اسلات جذب شده، جفت های برگشت و degraded fallback: از `oracle.test.ts`، `known-artefacts.test.ts`، `degraded.test.ts`، `journey-oracle.test.ts` (۱۱ ساعت آمادگی، دو جهت).

## ۵) parity، benchmark، sandbox

- **parity (سه سرور loopback):** سرور مبنا (build تمیز `587accb`)، کاندید، و کاندید بدون overlay. **۱۸۶۸ درخواست، ۰ تخلف.** پنجشنبه، جمعه، خط ۲، static، خطاها بدون تغییر؛ تغییر فقط روز عادی خط ۱ و فیلدهای اعلام شده. (`evidence/parity-r3c-vs-587accb.json`)
- **benchmark (cgroup ۱۹۲ MiB، بدون swap، ۱۰۰ نمونه، سه اجرا):** هر سه `WITHIN_BUDGETS`. اوج cgroup ۱۴۵٫۵ تا ۱۴۷٫۳ MiB (مبنا ۱۴۷٫۲). کاندید در هر فاز کمی کندتر از مبناست؛ event loop p95 بین ۲۶٫۶ و ۲۹٫۵ms در برابر بودجهٔ ۳۰ms (مبنا ۲۴٫۶). این **حاشیهٔ کم** در پایش دنبال می شود. اجرای اول با سرورهای دیگر روی میزبان اندکی بدتر بود و دو اجرای بعدی با میزبان آرام گرفته شد.
- **sandbox زیر سخت سازی Production (واحد موقت با DynamicUser، ProtectSystem=strict، ۱۹۲M):** ۱۳ از ۱۳ PASS. شامل شروع، `timetable.state=applied`، `event_id`، بسته بودن journey با سوئیچ خاموش، ۲۰ خواندن پیاپی، حافظه، overlay گم ← `baseline_missing` با یادداشت آشکار، بازگشت، `NRestarts=0`، بازگشت U2 جدا و سپس U1 و **برابری درخت با Production زنده hash به hash**. (`evidence/sandbox-rehearsal.json`)
- نمونهٔ API قبل/بعد با ساعت ثابت یکسان: `evidence/api-samples-before-after.json` (روز عادی ظهر، ۱۹:۴۰، ۲۰:۱۵، پنجشنبه و جمعه؛ دو روز آخر بایت به بایت یکسان).
- screenshot: `screenshots/` (قبل: PB ‏۳۶۰×۷۴۰؛ بعد: ۳۶۰×۷۴۰ با CTA و فرم بالای نوار پایین بدون overflow؛ ۳۹۰×۸۴۴ نتایج برنامه ریز و تب حرکت ها؛ بازدیدکنندهٔ Beta خاموش). همه با مرورگر Chromium روی previewهای loopback، **نه** Telegram WebView.

## ۶) حفاظت

نگهبان در برابر `protected-before.json` (همهٔ worktreeها، Production، کنترل، Nginx، unit): در پایان `protected_changes []` اجرا شد (خروجی در `evidence/guard-after.txt`). `/etc/besrah-journey/control.json` بدون تغییر. `network.json` برابر Production.

## ۷) ریسک باقی مانده (هیچ کدام مانع Beta نیست)

۱. **دقت زمان:** صبح، ظهر و روزهای دیگر هرگز مشاهده نشده اند؛ ریتم ۱۱:۵۵ تا ۱۹:۱۵ برون یابی است و ۹ حرکت بیشتر نشان می دهد. این تصمیم آگاهانهٔ مالک است و با برچسب «برآورد» نمایش داده می شود.
۲. **U1 پنهان نیست:** حتی با Beta خاموش، خروجی `/next` و `/trains` روز عادی خط ۱ برای همهٔ کاربران (و تابلو) عوض می شود. بدون U2 برچسب تازه نمایش داده نمی شود.
۳. **Beta عمومی اختیاری است:** هر بازدیدکننده می تواند وارد شود. خصوصی نیست.
۴. حاشیهٔ کم event loop و دیسک ۸۹ درصد پر.
۵. Telegram WebView واقعی و iOS آزموده نشده (`AWAITING_HUMAN` / `NOT_TESTED`).
۶. `event_id` را Mini App نمی خواند؛ فقط سرور هماهنگ کرده است.
۷. بازخورد خاموش است. جمع آوری بازخورد نیازمند مرحلهٔ جدا و GO جدا است.

## ۸) درخواست `PRODUCTION_DEPLOY_GO`

**دامنه:** فقط U1 (۲ فایل داده + ۹ فایل dist + یک restart) و U2 (۷ فایل Mini App)، با snapshot و آزمون بازیابی، smoke پس از هر مرحله و در پایان `enabled:true` با `feedbackEnabled:false` برای آزمون گوشی شما؛ kill switch و rollback مستقل U1/U2 آماده. بدون Nginx، بدون بازخورد، بدون `network.json`، بدون `food.js` و `bus-guide.json`. جزئیات: `R3C-U1-U2-RELEASE-PLAN.md`. تست گوشی: `R3C-ANDROID-SMOKE-FA.md`.
