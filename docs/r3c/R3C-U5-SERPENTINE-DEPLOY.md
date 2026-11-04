# R3-C U5 | نمای مارپیچی خط (2026-11-04)
مجوز: `PRODUCTION_DEPLOY_GO: U5 نمای مارپیچی`. فایل ها: `apps/miniapp/ui/tracker.js` و `apps/miniapp/app.css`. بدون restart، بدون تغییر کنترل و API.
- snapshot: `/var/backups/besrah/r3c-u5-20261104T114506Z` (۲۲۰۹ فایل، ۰ ناهمخوانی). hash هر دو فایل روی سایت زنده برابر plan. `NRestarts=0`. enabled:true، feedbackEnabled:false.
- سایت زنده (۳۶۰ و ۳۹۰): ۲۴ ایستگاه، ۱۲ قطار، ۰ همپوشانی متن/نشانگر، overflow صفر، ارتفاع نقشه ۹۲۰px.
- rollback: `preflight_overlay.py rollback --plan plan-u5.json --target /srv/besrah --snapshot /var/backups/besrah/r3c-u5-20261104T114506Z/snapshot-u5` (بدون restart؛ برمی گردد به U4).
