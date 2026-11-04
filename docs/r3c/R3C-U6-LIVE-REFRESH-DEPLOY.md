# R3-C U6 | بروزرسانی ۳ ثانیه ای و چیپ های خط در نمای خط (2026-11-04)
مجوز: دستور مالک «اوکی کن و مستقیم دیپلوی کن بدون تأیید من». فایل ها: `ui/tracker.js`، `ui/board.js`، `views/metro.js`. بدون restart، بدون API، کنترل دست نخورده.
- snapshot: `/var/backups/besrah/r3c-u6-20261104T115307Z` (۲۲۰۹ فایل، ۰ ناهمخوانی). hash هر ۳ فایل روی سایت زنده برابر plan. `NRestarts=0`.
- سایت زنده: تابلو هر ۳ ثانیه تازه می شود (بدون spinner و متن وضعیت)؛ ساعت نمای خط هر ۳ ثانیه می رود؛ چیپ های خط ۱ و ۲ در نمای خط دیده می شوند و فرم مشترک را عوض می کنند؛ خط ۲: ۱۳ ایستگاه، ۶ قطار، بدون همپوشانی.
- rollback: `preflight_overlay.py rollback --plan plan-u6.json --target /srv/besrah --snapshot /var/backups/besrah/r3c-u6-20261104T115307Z/snapshot-u6` (برمی گردد به U5).
