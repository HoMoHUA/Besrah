# U10-DEPLOY-REPORT | DEPLOYED، ۲۰۲۶-۱۱-۰۴ (۲۱:۰۹ تا ۲۱:۱۲ UTC)

مجوز: `PRODUCTION_DEPLOY_GO U10`. کد: commit `acc5ec0` (plan: `plan-u10-profile-accounts.json`، ۱۹ فایل: ۸ dist، ۱۱ assets).

- پیش از اجرا: ۰ ناهمخوانی pre-state و ۰ ناهمخوانی hash کاندید؛ کنترل بی تغییر (`enabled:true`, `feedbackEnabled:false`, `rolloutPercent:0`).
- checkpoint: `/var/backups/besrah/u10-20261104T210935Z` (۵ MiB: tar از `/srv/besrah`، site و snippetهای Nginx، drop-inها) و بازیابی آزمایی identical.
- ترتیب: Nginx (snippet `besrah-account-post.conf` + include، `nginx -t`، reload) ← drop-in `account.conf` + `daemon-reload` ← `dist` ← یک restart (`NRestarts=0`) ← `assets`.
- تأیید: hash هر ۱۱ فایل Mini App روی URL عمومی برابر plan. `GET /api/account/session` = guest و دسترس پذیر؛ `POST /api/account/telegram` با داده جعلی 401؛ prefs بدون نشست 401؛ `DELETE` 403؛ Origin بیگانه 403؛ `GET /api/recommendations/home` 403؛ `POST` همان 200 با کارت ایستگاه و غذا؛ stations/trains/shop/beta همه 200؛ `POST /api/trip` با `maxWalkMin` = 200 و علت «walk_limit_excluded_metro» (ساعت ۰۰:۵۴ تهران؛ گزینهٔ خودرو).
- مرورگر زنده: خانه (کارت «کجا می روید؟»، پیشنهاد حالا)، تب «پروفایل»، مبدأ پیش فرض «موقعیت فعلی من» با فوکوس روی مقصد؛ سرریز افقی ۰ روی ۳۲۰/۳۶۰/۳۹۰ برای خانه، پروفایل، مسیر، بسفود، بسراه و بسپی.
- پایگاه حساب: `/var/lib/private/besrah-account` (۰۷۰۰، مالک `besrah-core`). حافظهٔ هسته پس از راه اندازی ۴۰ MiB و پس از بار ۴۷ MiB.
- دیسک ۹۳ درصد (۳٫۲ GiB آزاد).

بازگشت: `preflight_overlay.py rollback` برای `snapshot-assets` سپس `snapshot-dist` و `systemctl restart besrah-core`؛ حذف include و فایل `besrah-account-post.conf` و `account.conf`؛ `nginx -t && systemctl reload nginx`. پایگاه حساب جدا می ماند.
AWAITING_HUMAN: ورود واقعی تلگرام روی Huawei (ماندن کوکی در WebView).
