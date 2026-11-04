# NEXT-AGENT-START | شروع سریع برای عامل بعدی

۱. کد کار: `cd /root/projects/besrah-3d && git status` (شاخهٔ `feature/three-domain`). شاخهٔ `main` با ۲۷ فایل تغییر قبلی لمس نشود (reset/clean ممنوع).
۲. خواندن به ترتیب: `HANDOFF-FINAL.md`، `ARCHITECTURE-AND-API.md`، `DECISIONS-AND-BACKLOG.md`، `RELEASE-RUNBOOK.md`.
۳. اجرای آزمون ها (سری، به دلیل سابقهٔ OOM): `bash scripts/net01/run_regression.sh /tmp/reg.log`. برای parity HTTP چهار پیش نمایش لازم است (۱۸۹۰۱ تا ۱۸۹۰۳ کاندید با `--mode=on|off|strict` و ۱۸۹۱۱ با `--mode=off --runtime-root=<export 587accb>`). با PID بسته شوند، نه `pkill -f`.
۴. پیش نمایش: `set -a; . /etc/besrah-maps/neshan.env; set +a; node scripts/preview-unified-metro.mjs --port=18941 --mode=on` و باز کردن `http://127.0.0.1:18941/app/` (فقط لوپ بک).
۵. داده: غذا `python3 scripts/food/build_food_index.py`؛ خرید `python3 scripts/shop/import_offers.py --out data/shop/catalog-v1.json` (فهرست دستی `data/shop/manifest-v1.json`).
۶. هر استقرار ← یک `PRODUCTION_DEPLOY_GO` جدید با plan hash دار. GO های قبلی R3-C معتبر نیستند.

## قوانین سخت

- فارسی با فاصله گذاری کامل («می شود»، «ایستگاه ها»). کد، کامنت و commit انگلیسی.
- هیچ داده، قیمت یا زمان تخمینی «قطعی» یا «لحظه ای» معرفی نشود. نامعلوم همان نامعلوم می ماند.
- کلید نشان فقط در `/etc/besrah-maps/neshan.env` (۰۶۰۰). در chat، commit، لاگ و گزارش نیاید.
- `session/` و `apps/miniapp/vendor/hm7/` و workflow های n8n تغییر نکنند. فقط فایل های ثبت شده در `MINIAPP_ASSETS` سرو می شوند؛ ماژول تازه ← ثبت در `packages/core/src/miniapp.ts` (و آزمون `asset-allowlist.test.mjs` آن را می گیرد).
- بودجهٔ حافظهٔ core: ۱۹۲ MiB (cgroup). اوج فعلی ۱۰۳ MiB.

## کار پیشنهادی بعدی (به ترتیب ارزش)

1. GO برای U7 و اجرای RELEASE-RUNBOOK، سپس تست مالک روی Telegram.
2. فعال سازی سرویس Search نشان (کلید جدا در `BESRAH_NESHAN_GEOCODING_KEY`) برای جست وجوی واقعی مکان.
3. انتخاب نقطه روی نقشه (نیازمند کلید نقشهٔ وب و تصمیم دربارهٔ CDN یا کاشی محلی).
4. تعویض خط ۱↔۲ در شریعتی (نیازمند زمان انتقال میدانی).
5. گسترش کاتالوگ خرید (منبع دوم با JSON-LD، ۵۰ تا ۱۰۰ کالا).
