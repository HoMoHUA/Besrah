# ARCHITECTURE-AND-API | سه دامنه (غذا، خرید، مسیریابی)

شاخه: `feature/three-domain` در `/root/projects/besrah-3d` (مبنا `a8cb909`). هیچ وابستگی تازه ای به npm یا pip اضافه نشده است.

## ۱) نقشهٔ ماژول ها (`packages/core/src`)

- `food/search.ts` و `food/routes.ts`: جست وجوی فقط خواندنی روی `data/food/food-index-v1.json.gz` (بارگذاری تنبل، ۵۰۳ در نبود فایل).
- `shop/search.ts`: جست وجوی فقط خواندنی روی `data/shop/catalog-v1.json` (بارگذاری تنبل، ۵۰۳ در نبود فایل).
- `trip/neshan.ts`: آداپتور سرور سمت نشان. کلید فقط از محیط می آید و فقط در سرآیند `Api-Key` می رود.
- `trip/plan.ts`: برنامه ریز خالص (وابستگی ها تزریق می شوند: router، metro، ایستگاه ها).
- `trip/routes.ts`: `POST /app/api/trip` و `POST /app/api/places`.
- `journey-beta/index.ts`: اکنون `{ planMetro, catalog }` برمی گرداند. `planMetro` همان gate، deadline و منبع مدل مسیر `/app/api/journey` را مصرف می کند و وقتی Beta خاموش است خطا می دهد.
- `server.ts`: ثبت `registerShop`، `registerTrip` (با `createNeshan(neshanOptionsFromEnv())`).

## ۲) APIهای تازه (همه `Cache-Control` مشخص، بدون لاگ، بدون ذخیرهٔ نقطه)

### غذا (GET)
- `/app/api/food/search?q&source&maxPrice&minPrice&lat&lon&radiusKm&sort&limit&offset`
- `/app/api/food/vendor?id[&lat&lon]`
- پاسخ شامل `snapshot{capturedFrom,capturedTo,ageHours,stale}` و `notes`. قیمت ۰ یا NULL یعنی `priceState:'unknown'`.

### خرید (GET)
- `/app/api/shop/search?q&maxPrice&sort(relevance|price)&limit&offset`
- `/app/api/shop/product?id=tl:<sku>`
- قیمت هر پیشنهاد: `state` یکی از `resolved | unresolved | quarantined`؛ `priceToman` فقط برای `resolved`. `stock` و `shipping` همیشه `unknown`.

### مسیریابی (POST JSON، سرآیند `Content-Type: application/json`)
- `/app/api/places` بدنه `{q}` ← ایستگاه ها (محلی) و در صورت وجود کلید، یک نشانی ژئوکد شده از نشان با `precision:'geocoded'`.
- `/app/api/trip` بدنه `{from:{lat,lon}, to:{lat,lon}, time?:"HH:MM"}`:
  - `status: ok | partial | unavailable` و `reason`.
  - `options` حداکثر ۲ مورد، با `kind: metro|car|walk`، `legs[]` و `basis` هر پا: `routed | model | assumption | unknown`.
  - `leaveAt` آخرین زمان خروج برای رسیدن به قطار انتخابی است. `ifMissed` قطار بعدی.
  - بدون مسیریاب: `arriveAt:null` و فقط `platformDepartures`.
- چرا POST: مختصات و متن جست وجو هرگز در URL نباشد. Nginx باید دو location دقیق داشته باشد (`deploy/nginx/besrah-trip-post.conf`).

## ۳) قراردادهای صداقت (تست شده)

- فاصلهٔ هوایی هرگز مدت نیست (`straightLineM` فقط توضیح است).
- ثابت های فرض: `ACCESS_S=180`، `EGRESS_S=120`، با برچسب `assumption`.
- `car` فقط با برچسب `provider_traffic`: یعنی نقطهٔ پایانی ترافیک دار سرویس، نه اثبات «زنده».
- مترو فقط هم خط. تعویض خط (مثل شریعتی ۱↔۲) پشتیبانی نمی شود و گزینه ای ساخته نمی شود.
- اتوبوس و تاکسی: وجود ندارد (نامعلوم).

## ۴) بودجهٔ منابع (اندازه گیری شده، cgroup با `MemoryMax=192M`)

- بیکار: ۳۹ MiB. پس از اولین `trip`: ۵۷. پس از اولین `food`: ۱۰۱. پس از ۶ جست وجوی دیگر: ۱۰۲. اوج: ۱۰۳ MiB (سقف ۱۹۲).
- سقف نشان: `BESRAH_NESHAN_DAILY_CAP` (پیش فرض ۲۰۰۰ تماس در روز)، حداکثر ۴ تماس هم زمان، timeout ۴ ثانیه.
- هر `trip` حداکثر حدود ۸ تماس پیاده/خودرو می زند (کش ۱۵ دقیقه برای پیاده و ۲ دقیقه برای خودرو).
