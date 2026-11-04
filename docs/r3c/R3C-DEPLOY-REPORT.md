# R3-C | گزارش استقرار (۲۰۲۶-۱۱-۰۴، 11:02 تا 11:04 UTC)

مجوز: `PRODUCTION_DEPLOY_GO` مالک برای U1 و U2 و سپس `enabled:true` با `feedbackEnabled:false`. کد: شاخهٔ `feature/r3c-experimental-beta`.

- snapshot و بازیابی آزمایی: `/var/backups/besrah/r3c-deploy-20261104T110208Z` (۲۲۰۵ فایل، ۰ ناهمخوانی در بازیابی).
- U1: ۱۱ فایل (۲ داده، ۹ dist)، سپس یک restart (`NRestarts=0`، بدون خطا در journal).
- U2: ۷ فایل Mini App؛ hash هر ۷ فایل روی https://besrah.arklyn.ir/ برابر plan.
- فقط ۱۸ فایل برنامه ریزی شده تغییر کرد (۱۴ تغییر، ۴ افزوده، ۰ حذف، ۰ تغییر خارج از برنامه): `evidence/deploy-tree-delta.json`. `food.js`، `bus-guide.json`، `network.json`، Nginx و unit دست نخوردند.
- کنترل: `{"enabled":true,"feedbackEnabled":false,"rolloutPercent":0}`؛ نسخهٔ قبلی در checkpoint.
- بازدیدکنندهٔ عادی با Beta خاموش (پیش از روشن کردن): بدون فرم و دکمه؛ پس از روشن شدن: «ورود اختیاری» دیده می شود و پس از آن فرم بالای نوار پایین (۳۶۰×۷۴۰، CTA در y=509 از 740) بدون overflow.
- بازخورد: POST به مسیر بازخورد ← ۵۰۳ (بسته).
- rollback: `preflight_overlay.py rollback --plan <plan-u2|plan-u1> --target /srv/besrah --snapshot /var/backups/besrah/r3c-deploy-20261104T110208Z/snapshot-u2|u1` (U2 اول؛ برای U1 بعد از آن یک restart). kill switch: `enabled:false` در `/etc/besrah-journey/control.json`.
