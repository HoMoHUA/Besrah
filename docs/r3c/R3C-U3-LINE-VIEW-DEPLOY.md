# R3-C U3 | استقرار نمای خط (2026-11-04)
مجوز: `PRODUCTION_DEPLOY_GO: U3 نمای خط`. فایل ها: `apps/miniapp/ui/tracker.js` و `apps/miniapp/app.css` (plan: `R3C-U3 line view`). بدون restart، بدون تغییر کنترل.
- snapshot: `/var/backups/besrah/r3c-u3-20261104T111332Z` (۲۲۰۹ فایل، ۰ ناهمخوانی tar و Production).
- hash هر دو فایل روی https://besrah.arklyn.ir/ برابر plan. `NRestarts=0`. کنترل: enabled:true، feedbackEnabled:false.
- سایت زنده: یک ray، ۱۲ نشانگر A/B/C، راهنما، بدون spine قدیمی، overflow صفر.
- rollback: `preflight_overlay.py rollback --plan plan-u3.json --target /srv/besrah --snapshot /var/backups/besrah/r3c-u3-20261104T111332Z/snapshot-u3` (بدون restart).
