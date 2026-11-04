# R3-C U4 | نمای خط v2 و قانون «در حال ورود» (2026-11-04)
مجوز: `PRODUCTION_DEPLOY_GO: U4 نمای خط و قانون در حال ورود`. فایل ها: `app.css`، `format.js`، `ui/board.js`، `ui/tracker.js`، `views/metro.js`. بدون restart، بدون تغییر کنترل و API.
- snapshot: `/var/backups/besrah/r3c-u4-20261104T113127Z` (۲۲۰۹ فایل، ۰ ناهمخوانی). hash هر ۵ فایل روی سایت زنده برابر plan. `NRestarts=0`. enabled:true، feedbackEnabled:false.
- سایت زنده: ۱۲ نشانگر بدون همپوشانی، یک rail، راهنمای فیلترشونده، کارت جزئیات چسبان، تابلو با شمارش روی دستگاه.
- rollback: `preflight_overlay.py rollback --plan plan-u4.json --target /srv/besrah --snapshot /var/backups/besrah/r3c-u4-20261104T113127Z/snapshot-u4` (بدون restart؛ برمی گردد به U3).
