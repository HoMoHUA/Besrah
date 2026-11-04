# RELEASE-RUNBOOK | U7: سه دامنه (غذا، مسیریابی، خرید)

**این سند مجوز اجرا نیست.** بدون یک `PRODUCTION_DEPLOY_GO` برای U7 هیچ دستوری اجرا نمی شود. تا این لحظه هیچ فایلی در `/srv/besrah`، Nginx یا systemd تغییر نکرده است. پیش نمایش فقط روی لوپ بک `127.0.0.1:18941` است.

## ۰) مبنای زنده و کاندید

- زنده: `feature/r3c-line-view @ a8cb909` (R3-C تا U6). Beta روشن، بازخورد خاموش.
- کاندید: commit `HEAD` شاخهٔ `feature/three-domain` (SHA در `HANDOFF-FINAL.md`).
- برنامهٔ hash دار: `docs/sprint/plan-u7-three-domains.json` (۲۰ فایل: ۲ داده، ۹ dist، ۹ assets؛ ۱ drift مستثنی: `bus-guide.json` که دست نمی خورد).

## ۱) دامنهٔ تغییر (allowlist)

| گروه | فایل ها |
|---|---|
| data | `data/food/food-index-v1.json.gz`، `data/shop/catalog-v1.json` (هر دو جدید) |
| dist | `food/{routes,search}.js`، `shop/search.js`، `trip/{neshan,plan,routes}.js` (جدید)، `journey-beta/index.js`، `miniapp.js`، `server.js` |
| assets | `api.js`، `app.css`، `app.js`، `navigation.js`، `services.js`، `views/food.js`، `views/trip.js`، `views/shop.js`، `assets/services/shop.svg` |
| خارج از plan | `/etc/nginx/snippets/besrah-trip-post.conf` + یک خط include، و `/etc/systemd/system/besrah-core.service.d/neshan.conf` (از `deploy/`) |

## ۲) ترتیب اجرا

1. **checkpoint:** `tar` از `/srv/besrah` + کپی unit + کپی `/etc/nginx/sites-enabled/besrah.arklyn.ir.conf` در `/var/backups/besrah/u7-<TS>/` با `SHA256SUMS`. بازیابی آزمایشی در پوشهٔ موقت (مثل R3-C).
2. **Nginx (reload، نه restart):** کپی `deploy/nginx/besrah-trip-post.conf` به snippets، افزودن `include snippets/besrah-trip-post.conf;` در بلوک TLS سایت **قبل** از include اصلی، `nginx -t`، `systemctl reload nginx`. تا این مرحله `POST /api/trip` در سطح عمومی 403 می دهد و UI رهیاب «محاسبه نشد» نشان می دهد.
3. **کلید:** `/etc/besrah-maps/neshan.env` از قبل وجود دارد (۰۶۰۰، root). کپی `deploy/systemd/besrah-core-neshan.conf` به `besrah-core.service.d/neshan.conf`، `systemctl daemon-reload`.
4. **دادهٔ core:** `preflight_overlay.py apply --plan docs/sprint/plan-u7-three-domains.json --candidate <export> --target /srv/besrah --snapshot <ck>/snapshot-core --group data` سپس `--group dist`.
5. **یک restart:** `systemctl restart besrah-core`. انتظار: `NRestarts` همان، `MemoryCurrent` کمتر از ۱۱۰ MiB پس از بار، `/api/beta` بی تغییر، `/api/next` دارای `event_id`.
6. **smoke loopback:** `curl 127.0.0.1:3080/app/api/shop/search`، `.../food/search?q=چلو%20کباب`، `POST /app/api/places {"q":"شریعتی"}`، `POST /app/api/trip` (دو نقطهٔ مشهد). همه 200 و JSON معتبر.
7. **assets:** `apply --group assets` (بدون restart). `views/metro.js` بدون تغییر است.
8. **تأیید عمومی:** `verify --state post` برای هر گروه، hash هر ۹ فایل Mini App روی `https://besrah.arklyn.ir/` با plan برابر، `POST https://besrah.arklyn.ir/api/trip` با JSON نمونه 200، و `GET /api/trip` همچنان 403.
9. **گزارش:** `docs/sprint/U7-DEPLOY-REPORT.md` با hashها و اندازه گیری حافظه.

## ۳) بازگشت (به ترتیب معکوس)

1. `rollback --group assets` (بدون restart).
2. `rollback --group dist` و `--group data` سپس `systemctl restart besrah-core`.
3. حذف `neshan.conf` و `daemon-reload` (فقط اگر restart شد).
4. حذف خط include و `nginx -t && systemctl reload nginx`.
- کنترل سریع بدون restart: `/etc/besrah-journey/control.json` با `enabled:false` فقط مسیر مترو (و در نتیجه پای مترو در رهیاب) را خاموش می کند؛ غذا و خرید جدا هستند و با حذف فایل داده 503 می دهند و مترو را تحت تأثیر قرار نمی دهند.

## ۴) پیش شرط های ایمنی (برقرار)

- `tests`: Core ۶۲۸، Mini App ۲۱۹، پایتون (`tests/shop`، `tests/data`، `tests/release`) و parity HTTP ۸ از ۸ با سرور مبنای `587accb`.
- حافظه (cgroup با `MemoryMax=192M`): بیکار ۳۹، اوج پس از همهٔ مسیرها ۱۰۳ MiB.
- هیچ کلیدی در مخزن، commit، لاگ یا گزارش نیست (اسکن).
- هزینهٔ نشان: سقف داخلی ۲۰۰۰ تماس در روز (`BESRAH_NESHAN_DAILY_CAP`)؛ هر سفر حدود ۴ تا ۸ تماس. کلید در گفت وگو فرستاده شده است و بهتر است پس از اتمام آزمون جایگزین شود.

## ۵) آنچه مالک باید خودش بیازماید (`AWAITING_HUMAN`)

Telegram WebView واقعی (Android و iOS): باز شدن سه کاشی، «موقعیت من» در رهیاب (پرسش مجوز)، لینک خارج شدن به تپسی فود/اسنپ فود/تکنولایف، پیمایش فهرست غذا. iOS `NOT_TESTED`.
