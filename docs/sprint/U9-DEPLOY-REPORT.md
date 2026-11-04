# U9-DEPLOY-REPORT | DEPLOYED، ۲۰۲۶-۱۱-۰۴ (۲۰:۱۹ تا ۲۰:۲۲ UTC)

مجوز: `PRODUCTION_DEPLOY_GO U9`. کد: commit `4d39c97`. plan: `plan-u9-public-ready.json` (۱۶ فایل: ۲ dist، ۱۴ assets).

- پیش از اجرا: ۰ ناهمخوانی pre-state و ۰ ناهمخوانی hash کاندید. کنترل بی تغییر: `enabled:true`, `feedbackEnabled:false`, `rolloutPercent:0`.
- checkpoint: `/var/backups/besrah/u9-20261104T201954Z` (tar از `/srv/besrah`، ۵ MiB) و بازیابی آزمایی identical.
- اجرا: `dist` ← verify OK ← یک restart (`NRestarts=0`) ← `assets` ← verify OK. Nginx و systemd دست نخوردند.
- تأیید روی URL عمومی: hash هر ۱۴ فایل Mini App برابر plan (`index.html` روی `/` سرو می شود و برابر بود). `/api/shop`, `/api/food`, `/api/trains?line=2`, `/api/stations`, `/api/beta` همه 200؛ `GET /api/trip` 403؛ `POST /api/trip` 200.
- مرورگر زنده: سه کاشی (بسراه، بسفود، بسپی)، کاشی قدیمی ۰، تب های بسراه، tracker (۲۴ عنصر) سالم، جست وجوی مکان در تب مسیر، بسپی با ۱۰ کالا در صفحهٔ اول، صفحهٔ «همه سرویس ها» و «درباره» به روز. سرریز افقی ۰ روی ۳۲۰/۳۶۰/۳۹۰ برای خانه، بسراه، بسفود و بسپی.
- U8: «چلو کباب» با مرتب سازی ارزان ترین ← ۱۵۲٬۱۵۰ ، ۱۶۱٬۰۰۰ ، ۱۸۰٬۰۰۰ تومان (غذاهای واقعی، نه جانبی).
- منابع: حافظهٔ فعلی ۱۲۳ MiB (سقف ۱۹۲) پس از بار و بارگذاری ایندکس غذا. دیسک ۹۲ درصد.
- توجه: در زمان آزمون (حدود ۲۳:۵۰ به وقت تهران) قطار مناسبی در مدل نبود؛ `/api/trip` درست و صادقانه فقط گزینهٔ خودرو (`partial`) داد.

بازگشت: `preflight_overlay.py rollback --plan docs/sprint/plan-u9-public-ready.json --target /srv/besrah --snapshot /var/backups/besrah/u9-20261104T201954Z/snapshot-assets` سپس همان برای `snapshot-dist` و `systemctl restart besrah-core`.
