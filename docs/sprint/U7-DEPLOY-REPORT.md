# U7-DEPLOY-REPORT | DEPLOYED، ۲۰۲۶-۱۱-۰۴ (۱۳:۵۱ تا ۱۳:۵۳ UTC)

مجوز: `PRODUCTION_DEPLOY_GO U7` از مالک. کد: commit `48efb70` (محتوای کد؛ commit های بعدی فقط مستندات و U8 اند). plan: `docs/sprint/plan-u7-three-domains.json`.

## پیش از اجرا
- pre-state هر ۲۰ فایل = Production (۰ ناهمخوانی)؛ hash کاندید از export تمیز HEAD = plan (۰ ناهمخوانی از ۲۰).
- کنترل: `enabled:true`, `feedbackEnabled:false`, `rolloutPercent:0` (بدون تغییر). `besrah-core` فعال، `NRestarts=0`.
- دیسک: ۹۲ درصد، ۳٫۵ GiB آزاد. چون `/srv/besrah` فقط ۲۴ MiB است، snapshot کل درخت ۴٫۴ MiB شد؛ چیزی پاک نشد.
- checkpoint: `/var/backups/besrah/u7-20261104T135122Z` (tar از `/srv/besrah`، site و snippet Nginx، unit و drop-in ها، `SHA256SUMS`) + بازیابی آزمایی در پوشهٔ موقت: **identical**.

## اجرا (به ترتیب)
1. Nginx: snippet `besrah-trip-post.conf` + یک خط include قبل از include اصلی؛ `nginx -t` موفق؛ `reload` (بدون restart). `GET /api/trip` ← 403.
2. systemd: `besrah-core.service.d/neshan.conf` (`EnvironmentFile=-/etc/besrah-maps/neshan.env`) + `daemon-reload`.
3. overlay: `data` (۲ فایل) ← `dist` (۹ فایل)، هر دو `verify post: OK`.
4. **یک restart** `besrah-core`: `NRestarts=0`، `MemoryCurrent=37 MiB` پس از بالا آمدن. `/api/beta` بی تغییر و `timetable.state=applied`.
5. `assets` (۹ فایل، بدون restart) ← `verify post: OK`.

## تأیید روی URL عمومی
- hash هر ۹ فایل Mini App روی `https://besrah.arklyn.ir/` = plan (**۹ از ۹**).
- `GET /api/trip` و `/api/places` ← 403. `POST /api/places` با `text/plain` ← 415. `POST /api/trip` با JSON ← 200 در ۱٫۱ ثانیه.
- مسیر واقعی (دو نقطهٔ مشهد، نشان): `status ok`، دو گزینه (خودرو و مترو)، `walk` و `car` هر دو routed.
- `/api/shop/search` 200، `/api/food/search` 200، `/api/trains?line=2` 200، `/api/stations` 200. بازگشت قدیمی ها: مترو و تابلو و نمای خط (۳۶ عنصر tracker) سالم.
- سرریز افقی صفر برای خانه، غذا، رهیاب، بسخرید و مترو روی ۳۲۰/۳۶۰/۳۹۰.
- جریان کامل رهیاب روی سایت زنده (جست وجوی «دانشگاه فردوسی» ← «ایستگاه غدیر» ← مسیر): دو کارت، خودرو ۲۳ دقیقه و مترو ۳۱ دقیقه.
- بسفود روی سایت زنده: «چلو کباب» ← ۲۰۴ فروشگاه، دکمهٔ «سفارش در اسنپ فود». بسخرید: ۱۱ کالا.
- پس از بار: `MemoryCurrent≈94 MiB` و اوج `99 MiB` (سقف ۱۹۲)، `NRestarts=0`.

## کنترل و بازگشت
- `rollback`: `preflight_overlay.py rollback --plan docs/sprint/plan-u7-three-domains.json --target /srv/besrah --snapshot /var/backups/besrah/u7-20261104T135122Z/snapshot-assets --group assets` سپس همان برای `snapshot-dist` و `snapshot-data` و `systemctl restart besrah-core`.
- Nginx: حذف خط include و فایل snippet، `nginx -t && systemctl reload nginx` (نسخهٔ قبلی site در checkpoint).
- مصرف نشان: سقف داخلی ۲۰۰۰ تماس در روز، ۴ تماس هم زمان، timeout ۴ ثانیه، محدودیت ۲۰ درخواست در دقیقه برای هر IP و ۹۰ کل (لایهٔ برنامه) به علاوهٔ `limit_req` Nginx. `access_log off` برای دو مسیر POST.

## چرخش کلید (الزامی)
وضعیت: **ROTATION REQUIRED**. کلید در گفت وگو فرستاده شده بود. در مخزن، commit، ZIP، گزارش و لاگ نیست (اسکن). اقدام مالک: در پنل نشان کلید جدید بسازد، کلید قدیمی را غیرفعال کند و مقدار تازه را برای من ارسال نکند؛ فقط خط `BESRAH_NESHAN_KEY=...` در `/etc/besrah-maps/neshan.env` عوض شود و `systemctl restart besrah-core` بخورد.
