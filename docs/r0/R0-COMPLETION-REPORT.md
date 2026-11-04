# گزارش پایان R0 — تثبیت خط مبنا و صحت داده بِسراه

**وضعیت:** R0 در نسخه کاری تکمیل و راستی آزمایی شد؛ **هیچ انتشار روی Production انجام نشد**. اجرای R1 تا R7 شروع نشده است و نیاز به تأیید بعدی مالک دارد.

**تاریخ اجرا:** ۲ نوامبر ۲۰۲۶؛ checkpoint در `07:14:41 UTC` و بررسی نهایی اصلی در حدود `07:48 UTC`، برابر با حدود `11:18` تهران. زمان دقیق اجرای هر مجموعه آزمون در evidence ثبت شده است.

**مخزن:** `/root/projects/besrah`  
**نسخه مستقر:** `/srv/besrah`  
**HEAD شاخه اصلی قبل و بعد:** `3b3dbd323f73545dba355b1b285d5b1f1b9912be`

---

## ۱. نتیجه اجرایی و مرز اختیار

موارد مجاز R0 انجام شدند:

1. وضعیت Git، تغییرات قبلی، untracked ها و تفاوت فایل های کاری/مستقر دوباره ثبت شد.
2. از تمام درخت کاری و Production، با metadata گیت و فایل های untracked/ignored، checkpoint خصوصی تهیه و بازیابی آن در پوشه جدا آزمایش شد.
3. منشأ ۹۵ خط فعلی اتوبوس در یک overlay نسخه دار ثبت شد؛ pipeline اکنون خروجی فعلی را بازتولید می کند.
4. علت دو تست شکست خورده با اصلاح pipeline و assertions متناسب با مدل «پایه + اصلاحات» رفع شد؛ محتوا یا ترتیب توقف ها حذف نشد.
5. ابزار ساخت/اعتبارسنجی Release Manifest و manifest واقعی candidate/deployed ساخته شد.
6. وابستگی fatal راه اندازی مترو به کاتالوگ اختیاری غذا رفع شد.
7. درخواست زودهنگام مکان از init بسفود حذف شد؛ فقط اقدام صریح کاربر آن را آغاز می کند.
8. typecheck، build محلی، مجموعه تست ها، smoke واقعی فرایند محلی و رفتار مرورگر آزمایش شدند.
9. تغییرات قبلی در checkpoint جدا و R0 در commit های موضوعی شاخه بازبینی ثبت شد؛ شاخه اصلی، index آن و کارهای قبلی بازنویسی نشدند.
10. تصمیم معماری مالک درباره حضور **Preference و Memory از ابتدای طراحی R1** ثبت شد؛ هیچ قرارداد یا engine مربوط به R1 پیاده سازی نشد.

**انجام نشد:** deploy، restart/reload سرویس Production، تغییر Nginx/systemd، انتشار workflow، ارسال پیام واقعی بات، تغییر HM7، بازطراحی UI، نصب dependency، ایجاد DB شخصی، اجرای سفارش/پرداخت یا ساخت Intelligence Core.

---

## ۲. خط مبنا و حفاظت از کارهای قبلی

### ۲.۱ وضعیت اولیه

پیش از R0، شش فایل tracked تغییر ثبت نشده داشتند:

```text
apps/miniapp/api.js
apps/miniapp/api.test.mjs
apps/miniapp/app.css
apps/miniapp/ui/tracker.js
apps/miniapp/views/food.js
packages/core/src/server.ts
```

فایل های untracked پیشین شامل تست ردیاب، دو سند معماری/شناخت نامه، آداپتور وضعیت غذا و تست هایش، prototype پیشنهاددهنده، تحقیق های دو ارائه دهنده و `research/vendors.sqlite` بودند. بعضی از این تغییرات قبلاً منتشر شده بودند؛ در نتیجه HEAD معادل تمام نسخه مستقر نبود.

در شروع، فایل های کاری و مستقر ردیاب، CSS، API، کاتالوگ غذا، داده اتوبوس، network و compiled server یکسان بودند. اختلاف `views/food.js` از قبل وجود داشت: نسخه کاری timezone صریح تهران داشت، ولی نسخه مستقر از timezone مرورگر استفاده می کرد. این اختلاف قبلی همراه انتشار ناخواسته وارد Production نشد.

### ۲.۲ checkpoint قابل بازیابی

مسیر خصوصی:

```text
/var/backups/besrah/r0-20261102T071441Z/
  workspace.tar.zst
  workspace.tar.zst.sha256
  workspace-inventory.json
  production.tar.zst
  production.tar.zst.sha256
  production-inventory.json
  git-status.txt
  git-diff.txt
  git-staged.txt
  git-head.txt
  git-dir.txt
  baseline-git-ref.json
  README.txt
```

- archive کاری: **۵٬۸۲۵ ورودی فایل/پیوند**؛ ۷۵٬۰۴۷٬۱۰۸ بایت فشرده.
- archive Production: **۲٬۱۷۹ ورودی فایل/پیوند**؛ ۴٬۵۵۸٬۱۹۳ بایت فشرده.
- archive ها تمام درخت ها را شامل می شوند؛ از جمله `.git`، داده تحقیق، session در صورت وجود و dependency های محلی. symlink ها دنبال نشده و خود پیوند حفظ شده است.
- directory با دسترسی `0700` و فایل های اولیه archive/inventory با `0600` ساخته شدند.
- بایت/اندازه/SHA-256 هر فایل و مقصد هر symlink در archive با inventory مبدا تطبیق داده شد.
- **بازیابی واقعی** archive کاری در پوشه تازه زیر انجام شد و تمام ۵٬۸۲۵ ورودی آن با inventory اولیه مطابق بود:

```text
/root/.hermes/cache/scratch/besrah-r0-restore-20261102/
```

archive ها حاوی داده خصوصی و احتمالا داده ورود هستند؛ برای دانلود عمومی یا commit مناسب نیستند. این گزارش فقط مسیر و شواهد را می دهد، نه محتوای محرمانه را.

### ۲.۳ روش بازیابی ایمن

بازیابی روی درخت کاری جاری یا روی Production مجاز نشده است. برای بررسی یک نسخه بازیابی شده، فقط یک پوشه خالی جدید انتخاب شود:

```sh
# Example only: NEW-EMPTY-DIRECTORY must not be the active project/runtime.
sha256sum -c workspace.tar.zst.sha256
tar --zstd -xf workspace.tar.zst -C NEW-EMPTY-DIRECTORY
```

برای بازگردانی واقعی، ابتدا وضعیت تازه و scope بازگردانی بررسی شود؛ از `reset --hard`، `clean` یا استخراج archive روی کار فعال استفاده نشده است.

### ۲.۴ شواهد عدم تخریب

مقایسه مجدد با inventory checkpoint نشان داد:

- هیچ فایل قبلی، خارج از metadata داخلی Git، مفقود نشده است.
- تمام فایل های قبلی `research/` و `session/` بدون تغییر مانده اند.
- `data/field/`، `data/official/` و `data/bus/guide/` بدون تغییر مانده اند.
- database اصلی اتوبوس و source خام دست نخورده اند.
- HM7 و تمام فایل های `apps/miniapp/vendor/`، CSS و ردیاب مترو نسبت به شروع R0 تغییر نکرده اند.
- تغییر ignored اضافی قابل مشاهده، نتیجه cache آزمون Vitest و build محلی `dist/server.js` است؛ نه تغییر dependency یا داده خام.

---

## ۳. علت دقیق دو شکست اتوبوس

### شکست اول: خروجی از سازنده قابل بازتولید نبود

`scripts/build_bus_app_data.py` قبلی فقط guide بازبینی شده را می خواند. guide شامل ۹۲ خط و ۱۸۰ variant بود؛ ولی خروجی مینی اپ پس از اصلاح های قبلی، مستقیماً به ۹۵ خط و ۱۸۸ variant تغییر کرده بود.

در نتیجه `--check` به درستی اختلاف فایل و خروجی قابل ساخت را گزارش می کرد. راه حل، بازنویسی فایل از guide قدیمی و حذف تغییرات کاربر نبود؛ باید اصلاحات به ورودی رسمی pipeline تبدیل می شدند.

### شکست دوم: فرض نادرست «خروجی = فقط guide»

تست دوم برای کل خروجی، ۹۲ خط و ۱۸۰ variant انتظار داشت. این فرض پس از اضافه شدن اصلاحات دیگر درست نبود. علاوه بر آن، تست تمام ref ها را بدون alias با ref خام مقایسه می کرد.

اصلاح انجام شده:

- guide همچنان ۹۲ خط/۱۸۰ variant است و همه داده هایش دقیق بررسی می شوند.
- خروجی «guide + overlay» باید دقیقاً ۹۵ خط/۱۸۸ variant داشته باشد.
- alias های تأییدشده توسط درخواست مالک، هنگام مقایسه ref خام و نمایشی اعمال می شوند.
- تک تک ۱۸۰ variant اصلی، endpoint ها و ترتیب نام توقف ها همچنان با guide مقایسه می شوند.
- ۸ variant افزوده نیز با شناسه و محتوای قبلی حفظ و بررسی می شوند.
- به جای کمتر کردن assertion، بررسی metadata، provenance، semantic hash، determinism و ورودی نامعتبر اضافه شد.

---

## ۴. ساختار جدید pipeline و حفظ اصلاحات

```text
Guide بازبینی شده و بدون تغییر
          +
data/bus/corrections/ui-v1.json
          ↓ اعتبارسنجی نسخه، schema، hash و provenance
scripts/build_bus_app_data.py
          ↓ خروجی deterministic
apps/miniapp/assets/bus-guide.json
```

### ۴.۱ لایه اصلاحات

فایل جدید `data/bus/corrections/ui-v1.json` شامل این موارد است:

- `schema_version: 1` و `overlay_id: bus-ui-corrections-v1`؛
- اتصال به SHA-256 مانیفست guide پایه؛
- اثر انگشت بایت و معنای فایل مصرفی قبلی، برای ثبت مبنای حفظ محتوا؛
- نام های اضافه شده قبلی، با حفظ تمام index ها؛
- تغییر `38.1 → 38/1` همراه با حفظ variant قبلی هر دو نگارش؛
- تغییر `800 → 801` همراه با حفظ هر دو variant؛
- ۸ variant قبلی خطوط `129 / 830 / 832 / 833`؛
- منشأ متفاوت ادعای وجود خط، محدوده اعلام شده و توالی توقف ها.

### ۴.۲ تمایز منشأ با صحت عملیاتی

وجود چهار خط و تغییر شماره ها از درخواست مالک ثبت شده اند. محدوده خط ۱۲۹ و فاصله اعلامی ۱۰ دقیقه از متن ارائه شده مالک آمده اند.

**اما ترتیب توقف ها و endpoint های ۸ variant افزوده، از منبع مستقل تأیید نشده اند و با عنوان `assistant_entered_unverified` ثبت شده اند.** حفظ آن ها، اعلام صحت یا رسمی بودن آن ها نیست. برای خطوط ۸۳۰/۸۳۲/۸۳۳، مناطق حاصل از توالی قدیمی به عنوان گفته مالک معرفی نشده اند.

۱۰ دقیقه خط ۱۲۹ به عنوان `owner_reported_announcement` نگهداری شده است، نه timetable زمان وابسته یا arrival زنده. پرچم های `official_completeness_verified` و `live_arrivals` همچنان `false` اند.

### ۴.۳ شمارش واقعی جدید

| بخش | خطوط | variant | رخداد توقف | نام های dictionary |
|---|---:|---:|---:|---:|
| guide پایه | ۹۲ | ۱۸۰ | ۵٬۲۷۵ | ۱٬۶۸۹ |
| افزوده های overlay | ۴ | ۸ | ۱۰۶ | ۳۶ |
| خروجی نهایی | ۹۵ | ۱۸۸ | ۵٬۳۸۱ | ۱٬۷۲۵ |

علت جمع خطوط: یک ادغام، یک تغییر نام و چهار افزوده؛ بنابراین ۹۲ منهای یک به اضافه چهار برابر ۹۵ است.

از ۱٬۷۲۵ نام dictionary، **۱٬۷۱۹ مورد استفاده می شود و ۶ نام استفاده نشده قبلی حفظ شده اند**. این شش نام، ایستگاه تازه یا توقف فعال محسوب نمی شوند. داده رسمی جدید یا مختصات ساختگی وارد نشده است.

### ۴.۴ شواهد حفظ کامل UI data

ساختارهای `v`، `n` و `l` فایل قبل و بعد R0 با هم برابرند؛ یعنی شماره ها، نام ها، ترتیب خطوط، variant ID، endpoint، پرچم `d` و index/ترتیب توقف ها تغییر نکرده اند. تغییر فایل خروجی فقط metadata است.

Semantic SHA-256 روی JSON فشرده `{n,l}`، قبل و بعد:

```text
9b7512e1d2c085814b6398d7ce2b5e345154ee2fbfd4440a39e20d70958ffe99
```

SHA-256 بایت های فایل جدید:

```text
2049e4981765ff182dbb2b7a84b272c61f311988db2f1565e3d0a54d379d0f98
```

این hash ها شواهد حفظ/بازتولید هستند؛ صحت شبکه در دنیای واقعی را تضمین نمی کنند.

### ۴.۵ اعتبارسنجی و نسخه بندی

سازنده کلید تکراری JSON، نسخه/فیلد ناشناخته، hash پایه ناسازگار، نام تکراری، index نامعتبر، variant ID برخوردکننده، چرخه تغییر ref، از دست رفتن variant پایه، official claim نامعتبر و تبدیل اعلام headway به schedule را رد می کند.

دو build مستقل بایت به بایت یکسان اند؛ زمان ساخت متغیر وارد JSON نشده است. تغییر معتبر بعدی در پایه/توالی ها نیازمند نسخه جدید و بازبینی صریح است؛ semantic hash نباید برای پنهان کردن تغییر محتوا به صورت خاموش عوض شود.

---

## ۵. اصلاح P0 راه اندازی Transit

### قبل

`buildServer()` در startup کاتالوگ غذا را synchronous parse می کرد؛ نبود فایل یا JSON/ساختار خراب، exception ایجاد می کرد و کل core از جمله مترو بالا نمی آمد.

### اکنون در candidate

- load و بررسی شکل کاتالوگ در boundary اختیاری با fallback قرار گرفته است.
- در خطای load/parse، map قابل اعتماد فروشگاه پاک و capability استعلام غذا unavailable می شود.
- مترو، aliases موجود، station metadata، app shell و `/health` همچنان کار می کنند.
- endpoint وضعیت برای ورودی معتبر در این حالت پاسخ می دهد:

```json
{
  "error": "food_status_unavailable",
  "status": "unknown",
  "observedAt": null
}
```

کد HTTP برابر `503` و cache برابر `no-store` است. اعتبارسنجی request همچنان قبل از بررسی unavailable اجرا می شود؛ ورودی malformed پاسخ `400` می گیرد. در حالت کاتالوگ سالم، قرارداد قبلی، مختصات قابل اعتماد، تشخیص شناسه مبهم و محدودیت فراخوانی حفظ شده اند. API client موجود خطای upstream را به unknown می رساند و امکان تلاش دوباره را حفظ می کند.

این یک اصلاح failure isolation است؛ capability جدید یا quote جدید ساخته نشده است. availability فقط در startup تعیین می شود؛ hot reload/retry loop اضافه نشده است.

### شاهد واقعی فرایند، جدا از mock

بعد از build محلی، compiled core در یک درخت آزمایشی و روی پورت loopback جدا اجرا شد. در دو حالت «فایل غذا مفقود» و «JSON غذا خراب»:

- `/health`، `/app/`، `/app/api/stations` و query زمان مترو: `200`؛
- alias قطار خط ۱ و خط ۲: `200`؛
- وضعیت غذا: `503 / unknown`؛
- هر دو فرایند آزمایشی متوقف شدند.

هیچ فایل Production برای شبیه سازی خطا جابه جا یا خراب نشد.

---

## ۶. اصلاح P0 درخواست زودهنگام مکان

فقط بلوک فراخوانی location از `init()` بسفود حذف شد. کاتالوگ همچنان load می شود، view و فیلترها ساخته می شوند و مرجع اختیاری ایستگاه باقی می ماند؛ اما وجود `navigator.geolocation` به عنوان رضایت کاربر تلقی نمی شود.

مکان فقط با دکمه موجود «تشخیص خودکار از موقعیت من» درخواست می شود. مسیر Telegram native و fallback مرورگر حفظ شده اند. ranking با مختصات موقت داخل خود view انجام می شود؛ درخواست وضعیت همچنان فقط vendor ID دارد، نه مکان شخصی کاربر.

### شاهد مرورگر محلی

در Chromium با عرض ۳۹۰ و یک موقعیت **fixture غیرشخصی**:

- ساخت صفحه خانه و دریافت کاتالوگ: صفر فراخوانی location؛
- ورود بسفود: صفر فراخوانی location؛
- لمس صریح دکمه: دقیقاً یک فراخوانی location؛
- نتایج از مرجع ایستگاه به موقعیت fixture تغییر کردند؛
- overflow افقی در همان حالت صفر بود.

تست های خودکار نیز `onShow` تکراری، رد دسترسی، نبود قابلیت مکان، مسیر Telegram و reset مرجع ایستگاه را پوشش می دهند.

این بررسی، تأیید گوشی واقعی یا اصلاح همه خطاهای مختصات گذشته نیست. فهرست hardcoded ایستگاه های بسفود و wording «موقعیت دقیق» در R0 بازطراحی نشده اند و در بخش موارد باقی مانده آمده اند.

---

## ۷. Release Manifest: ساختار، پوشش و صحت

### ۷.۱ ابزار

```text
scripts/release_inventory.py
tests/release/test_release_inventory.py
docs/release-inventory.md
```

بدون dependency جدید، بر پایه Python standard library و Git محلی. ابزار build/deploy/restart نمی کند و Production فقط ورودی خواندنی است.

نسخه قرارداد: **`schema_version = 1`**؛ نسخه سیاست allowlist نهایی: **`policy_version = 2`**.

در بازبینی عامل اصلی، مشخص شد overlay جدید اتوبوس و generator آن در سیاست اولیه هویت نبودند. تست رفتاری تازه ابتدا شکست خورد؛ سپس هر دو به allowlist صریح اضافه شدند و policy به ۲ ارتقا یافت. اکنون تغییر هر یک، manifest قبلی را نامعتبر می کند.

### ۷.۲ محل manifest واقعی

```text
/var/backups/besrah/r0-20261102T071441Z/R0.manifest.json
```

manifest عمداً خارج از هر دو input root نوشته شده تا خودش را hash نکند، Git dirt را با خروجی خودش تغییر ندهد یا ناخواسته فایل source/runtime را بازنویسی نکند.

### ۷.۳ محتوا

- `candidate`: هویت snapshot کاری، HEAD جدا، پرچم های staged/unstaged/untracked، SHA-256/اندازه فایل های allowlisted و داده های شمرده شده؛
- `deployed`: هویت مستقل فایل های فعلاً مستقر، بدون نسبت دادن commit تأییدنشده به آن؛
- `comparison`: فایل های مشترک متفاوت، فقط candidate، فقط deployed و تعداد برابر؛
- checksum مستقل هر snapshot و کل manifest؛
- source TS، package/lock، config build، runtime dist، assets واقعی Mini App، ورودی های تعیین شده داده و generator/overlay اتوبوس؛
- آمار JSON، CSV و SQLite فقط به صورت تعداد، نه محتوا یا مقادیر تماس/credential.

asset allowlist برای candidate از source و برای deployed از compiled runtime همان نسخه خوانده می شود؛ candidate نمی تواند فهرست فایل های deployment را از خودش به آن تحمیل کند.

پوشش بر اساس سیاست مثبت است؛ research، session، secrets، node_modules و raw tree دلخواه وارد نمی شوند. hash کاتالوگ عمومی، بایت های همان فایل موجود را شامل می شود، اما مقادیر تماس از آن استخراج یا داخل manifest تکرار نمی شوند. نبود اطلاعات تماس در manifest به معنی حذف فیلدهای قبلی از کاتالوگ عمومی نیست.

### ۷.۴ هویت های ثبت شده

Candidate — **dirty_worktree_snapshot**، ۱۴۹ فایل:

```text
sha256:a0e82303cbd59c0c1094735d11b5731dd363e6fe40618134be7a1a9db1214e45
```

Deployed — **deployed_snapshot**، ۹۱ فایل:

```text
sha256:f6f3aec41954f0c1d67de2bd97d2ff532c57d9a38eecdaad2fce4cdc5259e06b
```

Checksum داخلی manifest، مستقل از قالب بندی فایل:

```text
0da400d001740e01d4a3ccf9c8ed9fb6a31a5a04dfd6d17e3acfbcfc2b5a69a4
```

SHA-256 فایل JSON نوشته شده:

```text
9a0e4a3aa14b4f7d1a7c8e77f832c7cac86ac6ea09428c4d16dcd8de69a24ad4
```

### ۷.۵ اعتبارسنجی

```sh
python3 scripts/release_inventory.py validate \
  --source-root /root/projects/besrah \
  --production-root /srv/besrah \
  --manifest /var/backups/besrah/r0-20261102T071441Z/R0.manifest.json
```

نتیجه واقعی:

```text
valid: candidate and deployed inventories match current allowed files
```

اعتبارسنجی، schema/version/type، کلید تکراری، مسیر ناامن/پیوند، missing/unexpected file، hash/size/statistics ناسازگار و Git metadata ناسازگار را بررسی می کند. تست ها حتی manifest دوباره checksum شده با آمار جعلی را رد می کنند. capture تکراری با ورودی ثابت deterministic است.

**حدود اعتبار:** manifest امضای اصالت، attestation build از commit، تضمین dependency نصب شده، هویت حافظه فرایند، SLA یا مجوز deploy نیست. dataset hash نیز صحت عملیاتی داده بیرونی را ثابت نمی کند. Git dirty به عنوان committed release معرفی نشده است.

---

## ۸. تفاوت دقیق candidate و Production

پس از build محلی، سه فایل مشترک allowlisted متفاوت اند:

| فایل | تفاوت |
|---|---|
| `apps/miniapp/assets/bus-guide.json` | metadata درست، lineage و hash overlay؛ محتوای UI برابر قبلی |
| `apps/miniapp/views/food.js` | حذف eager location در R0؛ به علاوه تفاوت timezone که از قبل وجود داشت |
| `packages/core/dist/server.js` | build محلی اصلاح failure isolation کاتالوگ غذا |

۸۸ فایل runtime/data/package مشترک برابرند. ۴۱ مسیر داده فقط در candidate وجود دارند؛ شامل overlay و داده های guide/export/SQLite تحقیق ساختاری اتوبوس که از قبل برای runtime فعلی همگی کپی نشده بودند. این عدد به معنی ۴۱ dependency runtime مفقود نیست و دستور sync خودکار آن ها نیست.

**Production تغییر نکرده است:** مقایسه کامل ۲٬۱۷۹ فایل/پیوند اولیه، نه فقط allowlist manifest، انجام شد. فرایند `besrah-core` همچنان با PID `47379` و زمان شروع `2026-11-01 12:27:43 UTC` فعال بود؛ restart نشده است. فایل های `/etc`، Nginx و workflow ها در این فاز نوشته نشدند.

بنابراین رفع های R0 اکنون **در نسخه کاری و build محلی** وجود دارند؛ کاربران Production هنوز رفتار قبلی را دارند. برای انتشار آن ها تأیید جدا لازم است.

---

## ۹. تست ها و شواهد اجرا

اجرای نهایی اصلی کاملاً سری بود:

| مجموعه | فرمان/خروجی | نتیجه |
|---|---|---|
| typecheck | `npm --prefix packages/core run typecheck` | موفق |
| Core | `npm --prefix packages/core test -- --maxWorkers=1 --no-file-parallelism` | ۷۸ تست در ۱۲ فایل، همه موفق |
| Mini App + data + n8n | `node --test --test-concurrency=1 apps/miniapp/*.test.mjs tests/data/*.test.mjs tests/n8n/*.test.mjs` | ۱۹۸ تست، همه موفق، بدون skip |
| Release inventory | `PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning -m unittest discover -s tests/release -v` | ۱۲ تست، همه موفق |
| Bus reproducibility | `python3 scripts/build_bus_app_data.py --check` | current، exit 0 |
| Build محلی | `npm --prefix packages/core run build` | موفق |
| whitespace | `git diff --check` | موفق |

**جمع تست های این سه مجموعه غیرتکراری: ۲۸۸ موفق، صفر شکست.** آزمون های هدفمند قبلی مجدداً به این عدد اضافه نشده اند.

### Red/Green ثبت شده

- اتوبوس قبل: ۰ موفق/۲ شکست؛ پس از اصلاح، هر دو مورد و assertions حفظ محتوا/provenance موفق شدند.
- startup قبل: ۶ شکست مربوط به خطای load/parse/shape؛ پس از اصلاح، مترو سالم و status unavailable قابل بررسی شد.
- location قبل: ۳ شکست با شمارش `1 !== 0`؛ پس از اصلاح، init صفر و action صریح یک بار فراخوانی داشت.
- integration manifest قبل: نبود overlay در inventory؛ پس از اصلاح policy، تست tamper روی overlay/generator موفق شد.

### smoke و مرورگر

- HTTP واقعی candidate روی `127.0.0.1:3180`: health، stations، قطارهای هر دو خط، next و bus asset با ۹۵ خط پاسخ موفق دادند.
- آزمایش fault واقعی در درخت جدا روی `3181`: هر دو حالت missing/invalid catalogue، Transit سالم و غذا `503/unknown`.
- Chromium محلی: بارگذاری خانه، بسفود، explicit location با fixture، فهرست ۹۵ خط و ترتیب آغازین ۲/۳/۴ تندرو، تغییر خط مترو و حفظ ۲۴/۱۳ ردیف مشاهده شد. overflow حالت های بررسی شده در عرض ۳۹۰ صفر بود.
- یک فرمان مرورگر در میانه آزمایش به timeout خورد؛ نتیجه آن به تنهایی pass محسوب نشد. وضعیت صفحه خوانده شد و بررسی های bus و هر دو خط مترو جداگانه با خروجی قابل مشاهده تکرار شدند.
- فرایندهای preview/fault متوقف شدند؛ پورت های ۳۱۸۰ و ۳۱۸۱ پس از پایان آزمایش listener نداشتند.

### محل شواهد خصوصی

```text
/var/backups/besrah/r0-20261102T071441Z/verification/
  results.json
  typecheck.log
  core.log
  miniapp-data-n8n.log
  release.log
  bus-check.log
  build.log
  isolated-startup-smoke.json
  local-food-consent.png   # در صورت وجود؛ fixture، نه مکان کاربر
```

تست های n8n سبز هستند، ولی تحویل زنده پیام Telegram، deep-link روی گوشی و سفارش واقعی در این فاز آزمایش نشده اند. موفقیت آزمون، دقت واقعی ETA یا رسمی بودن توقف های افزوده را ثابت نمی کند.

---

## ۱۰. تفکیک تغییرات برای بازبینی و Commit

### ۱۰.۱ شاخه و checkpoint جدا

```text
checkpoint/r0-preexisting-20261102T071441Z
  b95d29ab457448ae43c3ab6791b7bd38cba0e3fa

review/r0-20261102
  checkpoint قبلی
    → bus
    → startup
    → explicit location
    → release tooling
    → architecture decision
    → integration docs
    → completion report
```

checkpoint Git فقط تغییرات application/test/docs قبلی را جدا ثبت می کند؛ داده تحقیق، session و فایل های ignored کامل در archive خصوصی حفظ شده اند و به Git اضافه نشده اند.

شاخه اصلی checkout شده عوض نشده، index آن تغییر نکرده و HEAD همان `3b3dbd3` است. commit ها با index موقت مستقل ساخته شدند؛ R0 شامل commit ناخواسته کارهای قبلی نشده است. شاخه review برای بررسی است، نه release یا مجوز merge/deploy.

### ۱۰.۲ واحدهای مستقل

| واحد | commit بازبینی | فایل ها |
|---|---|---|
| اتوبوس | `366cbc84f888` | builder، overlay، README منشأ، bus asset، bus tests |
| startup | `819485365c47` | `server.ts` و `food-startup.test.ts` |
| location | `9ecd09c53043` | `food.js`، `food.test.mjs`، test-only DOM support |
| manifest | `cbc2d12a2aff` | release script، tests و documentation |
| تصمیم معماری | `fd84f7818b2d` | `docs/r0/ARCHITECTURE-DECISIONS.md` |
| تطبیق مستندات integration | `d3af8dfab69b` | توضیح دامنه تست کامل و پوشش policy ۲ در docs |
| گزارش پایان | commit پس از ثبت همین سند؛ با `git log review/r0-20261102` قابل مشاهده | همین فایل |

patch های اولیه واحدهای کد و ledger کامل در checkpoint خصوصی `R0-*.patch` و `R0-review-commits.json` هستند. برای نتیجه نهایی مستندات، تاریخچه شاخه review مرجع است.

برای بررسی بدون جابه جایی worktree کثیف:

```sh
git log --oneline checkpoint/r0-preexisting-20261102T071441Z..review/r0-20261102
git diff --stat checkpoint/r0-preexisting-20261102T071441Z..review/r0-20261102
git show review/r0-20261102:docs/r0/R0-COMPLETION-REPORT.md
```

### ۱۰.۳ فهرست کامل فایل های تغییر داده شده/افزوده R0

**تغییر نسبت به checkpoint:**

```text
apps/miniapp/assets/bus-guide.json
apps/miniapp/views/food.js
packages/core/src/server.ts
scripts/build_bus_app_data.py
tests/data/bus-app-data.test.mjs
```

**فایل های جدید R0:**

```text
data/bus/corrections/ui-v1.json
data/bus/corrections/README.fa.md
packages/core/tests/food-startup.test.ts
apps/miniapp/food.test.mjs
apps/miniapp/test-support/food-dom.mjs
scripts/release_inventory.py
tests/release/test_release_inventory.py
docs/release-inventory.md
docs/r0/ARCHITECTURE-DECISIONS.md
docs/r0/R0-COMPLETION-REPORT.md
```

`packages/core/dist/server.js` خروجی build محلی است و به عنوان تغییر مستقل منطق commit نشده است. cache تست در dependency tree نیز خروجی اجراست. فایل های قدیمی untracked، مثل `food-status.ts`، جزو ابتکار جدید R0 نیستند و در baseline جدا ثبت شده اند.

---

## ۱۱. اصلاح اولویت Preference و Memory

تصمیم مالک در `docs/r0/ARCHITECTURE-DECISIONS.md` ثبت شد:

- Preference و Memory از نخستین طراحی R1 جزو قراردادهای اصلی در کنار Context/Candidate/Recommendation هستند.
- ابتدا ترجیحات صریح، محلی، قابل ویرایش و حذف؛ مصرف واقعی آن ها توسط موتور تصمیم باید از ابتدا در مرزها پیش بینی شود.
- حالت بدون حافظه/کاربر ناشناس معتبر است.
- ترجیح نرم با محدودیت سخت و رضایت ذخیره/استفاده اشتباه نشود.
- حافظه سروری، auth، یادگیری رفتاری و sync اختیاری همچنان پروژه بعدی اند.

هیچ interface، engine، DB، preference storage جدید یا یادگیری در R0 ساخته نشد؛ ثبت این تصمیم، ورود به R1 نیست.

---

## ۱۲. موارد باقی مانده و محدودیت های R0

1. **تأیید مستقل مسیرهای افزوده اتوبوس:** هشت sequence/endpoint همچنان تأییدنشده اند. overlay صادقانه این وضعیت را نگه می دارد؛ UI برای نمایش badge جدید بازطراحی نشده است. planner آینده نباید آن ها را timed/official فرض کند.
2. **زمان بندی اتوبوس:** headway/arrival معتبر عملیاتی هنوز متصل نیست. اطلاعیه ۱۰ دقیقه خط ۱۲۹ جای timetable نیست.
3. **مکان بسفود:** hardcoded station catalogue، اختلاف آن با network و صحت برچسب «دقیق» هنوز باید جداگانه اصلاح شوند. R0 فقط eager permission را برطرف کرد.
4. **قیمت/موجودی/quote غذا:** freshness، minimum-order مجهول، stock، هزینه ارسال و quote نهایی هنوز برای توصیه اقتصادی نیاز به کار دارند؛ status=open سفارش قابل انجام را اثبات نمی کند.
5. **کاتالوگ و startup:** parsing اختیاری هنوز synchronous است؛ hot reload map وضعیت، سقف فایل و recovery پس از ترمیم کاتالوگ افزوده نشده اند. این ها توسعه بعدی اند، نه blocker رفع exception فعلی.
6. **حریم خصوصی داده موجود:** فیلد تماس بلااستفاده کاتالوگ عمومی در R0 حذف نشد؛ manifest مقادیرش را تکرار نمی کند.
7. **Release authenticity:** شناسنامه محلی اکنون قابل اعتبارسنجی است، ولی امضای release، hermetic build، کنترل dependency نصب شده و attestation runtime memory نیست.
8. **Git:** شاخه اصلی عمداً dirty باقی مانده تا کارهای قبلی دست نخورند؛ شاخه review واحدهای جدا دارد. merge یا commit release روی main مجوز جدا می خواهد.
9. **نقشه و تقویم Transit:** مسیر پیاده/ورودی/تعویض، تعرفه، calendar و سنجش مستقل ETA برای A→B کامل هنوز پیش نیازند؛ موتور کنونی تغییر نکرد.
10. **تأیید دستگاه واقعی/Telegram:** فقط تست خودکار و مرورگر محلی انجام شد؛ انتشار و آزمون عملیاتی واقعی بخشی از این فاز نبود.

---

## ۱۳. ارزیابی آمادگی R1 و تصمیم پایان

**آماده برای درخواست تأیید شروع R1 هستیم:** دو تست شکست خورده رفع شده اند، پایه داده و اصلاحات جدا و بازتولیدپذیرند، checkpoint قابل بازیابی داریم، هویت candidate/deployed مشخص است، دو خطر P0 مجاز اصلاح شده اند و مجموعه تست های مرتبط سبز است.

این آمادگی به معنی تأیید داده شهر، آماده بودن routing عمومی یا مجوز انتشار نیست. در R1 ابتدا قراردادهای خالص شامل **Preference و Memory از آغاز**، semantics شواهد، constraint gate و comparison ساخته خواهند شد؛ موارد داده ای باز مانع طراحی این کتابخانه نیستند، اما مانع ادعای توصیه عملیاتی کامل خواهند بود.

**توقف:** R0 پایان یافته است. بدون تأیید بعدی مالک، R1، merge انتشار و Deployment انجام نمی شود.
