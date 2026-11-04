# R2b-D1 — Source Manifest

**دامنه:** C1، دو ایستگاه هفت تیر و دانش آموز؛ دریافت تازه داده عمومی، نه تأیید میدانی و نه عرضه عمومی.

تعداد تلاش های HTTP مستقیم: **29**؛ وضعیت ها: `{'200': 16, 'None': 7, '302': 4, '401': 2}`. دوازده جست و جوی اکتشافی جداگانه در بایگانی خصوصی ثبت شده اند؛ status/header HTTP کارگزار جست و جو در ابزار افشا نشد و ساخته نشده است.

## بسته و جداسازی لایه ها

- بسته نسخه دار: `data/geospatial/r2bd1-c1-v1/`.
- raw OSM، query دقیق، metadata درخواست و هندسه/تحلیل مشتق جدا هستند. داده قدیمی و `network.json` تغییر نکرده اند.
- raw صفحات رسمی و پژوهش جانبی با حقوق اعلام نشده در بایگانی خصوصی بادوام checkpoint نگه داری شده اند؛ facts/hash/URL در بسته هستند. این بایگانی خارج از scratch پاک شونده قرار دارد.
- بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research`.
- `sourceLastEditedAt`، تاریخ انتشار، زمان capture آرشیو، snapshot نقشه، زمان دریافت و زمان مشاهده میدانی یکسان نیستند. observedAt میدانی برای برداشت نقشه نامعلوم است.
- `pass` در سلامت checksum به معنی تأیید وضعیت فیزیکی ورودی یا سکو نیست. پاسخ 401/redirect/timeout منبع هندسه یا شاهد نبود داده نیست.

## query هدفمند C1

- فایل: `queries/c1-pedestrian.overpassql`؛ SHA-256: `fac721c78bdb229ae6c2cdc9fe014f72e985beab4cdd5c1c3aa45d46d4d38c3f`.
- bbox جنوب، غرب، شمال، شرق: `[36.3233889, 59.496774, 36.33047, 59.5109444]`؛ CRS: `EPSG:4326`.
- highways، ورودی، مانع، indoor/level و عناصر ریلی ایستگاه/سکو در همین محدوده؛ نه route geometry اتوبوس و نه کل شبکه شهر.
- recursion فقط فرزندان عناصر انتخاب شده را برای هندسه کامل و شناسه گره ها می گیرد؛ بعضی way ها ممکن است اندکی بیرون envelope امتداد داشته باشند.

## درخواست ها و provenance

### osm-license

- URL: https://www.openstreetmap.org/copyright
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:13:43.494298+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:13:44.059742+00:00`.
- اندازه body: `21314 bytes`؛ SHA-256: `740676606bd071be13c8931dd22816667f9586fa282f1809d24c8e2175afe60f`.
- raw در بسته: `raw/osm-license.body`؛ metadata: `raw/osm-license.request.json`.
- مجوز/حقوق: ODbL-1.0؛ داده OSM: ODbL-1.0؛ متن ویکی راهنما: CC-BY-SA-2.0.
- نشانی مجوز: https://www.openstreetmap.org/copyright
- دامنه شاهد: فقط محتوای منبع/تگ/هندسه؛ ورود به سکو یا عبور میدانی را مستقلاً تأیید نمی کند.

### osm-wiki-foot

- URL: https://wiki.openstreetmap.org/wiki/Key:foot
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:17:38.366357+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:17:39.162637+00:00`.
- اندازه body: `66617 bytes`؛ SHA-256: `1125fedcb6cfcd177d89bdb649b0fcc86d3265a8537d37f01f0a21bd3dc95eb0`.
- raw در بسته: `raw/osm-wiki-foot.body`؛ metadata: `raw/osm-wiki-foot.request.json`.
- مجوز/حقوق: CC-BY-SA-2.0؛ داده OSM: ODbL-1.0؛ متن ویکی راهنما: CC-BY-SA-2.0.
- نشانی مجوز: https://wiki.openstreetmap.org/wiki/Wiki:Copyright
- دامنه شاهد: فقط محتوای منبع/تگ/هندسه؛ ورود به سکو یا عبور میدانی را مستقلاً تأیید نمی کند.

### osm-wiki-metro-mapping

- URL: https://wiki.openstreetmap.org/wiki/Metro_Mapping
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:13:44.619353+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:13:45.389888+00:00`.
- اندازه body: `57751 bytes`؛ SHA-256: `850aaed789bd6903b178bbdfe2e4e8d12c3895140d8a720b0cbf7d69f9c3d6fd`.
- raw در بسته: `raw/osm-wiki-metro-mapping.body`؛ metadata: `raw/osm-wiki-metro-mapping.request.json`.
- مجوز/حقوق: CC-BY-SA-2.0؛ داده OSM: ODbL-1.0؛ متن ویکی راهنما: CC-BY-SA-2.0.
- نشانی مجوز: https://wiki.openstreetmap.org/wiki/Wiki:Copyright
- دامنه شاهد: فقط محتوای منبع/تگ/هندسه؛ ورود به سکو یا عبور میدانی را مستقلاً تأیید نمی کند.

### osm-wiki-subway-entrance

- URL: https://wiki.openstreetmap.org/wiki/Tag:railway%3Dsubway_entrance
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:11:43.574133+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:11:44.409378+00:00`.
- اندازه body: `88243 bytes`؛ SHA-256: `eb66629735245d957f85e7d26958cac8931c600f88aba24654d6efcb3c6bb4b6`.
- raw در بسته: `raw/osm-wiki-subway-entrance.body`؛ metadata: `raw/osm-wiki-subway-entrance.request.json`.
- مجوز/حقوق: CC-BY-SA-2.0؛ داده OSM: ODbL-1.0؛ متن ویکی راهنما: CC-BY-SA-2.0.
- نشانی مجوز: https://wiki.openstreetmap.org/wiki/Wiki:Copyright
- دامنه شاهد: فقط محتوای منبع/تگ/هندسه؛ ورود به سکو یا عبور میدانی را مستقلاً تأیید نمی کند.

### overpass-de-c1-01

- URL: https://overpass-api.de/api/interpreter
- روش: `POST`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:09:56.314870+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:10:35.078836+00:00`.
- اندازه body: `319323 bytes`؛ SHA-256: `c47f70328055f52924f04be961494e34dbd5abd0f2e7d632095642046baf969b`.
- raw در بسته: `raw/overpass-de-c1-01.body`؛ metadata: `raw/overpass-de-c1-01.request.json`.
- مجوز/حقوق: ODbL-1.0؛ داده OSM: ODbL-1.0؛ متن ویکی راهنما: CC-BY-SA-2.0.
- نشانی مجوز: https://www.openstreetmap.org/copyright
- snapshot پایگاه OSM: `2026-11-02T20:09:06Z`؛ تازه بودن دریافت، اثبات تازه بودن مشاهده هر feature نیست.
- query: `queries/c1-pedestrian.overpassql`؛ SHA-256: `fac721c78bdb229ae6c2cdc9fe014f72e985beab4cdd5c1c3aa45d46d4d38c3f`.
- دامنه شاهد: فقط محتوای منبع/تگ/هندسه؛ ورود به سکو یا عبور میدانی را مستقلاً تأیید نمی کند.

### 01-metro-root

- URL: https://metro.mashhad.ir/
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:07:34.497989+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:07:54.973790+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/01-metro-root.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/01-metro-root.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Official Metro Mashhad homepage discovery; entrance/station-plan links sought
- خطا/محدودیت ثبت شده: `ReadTimeout: HTTPSConnectionPool(host='metro.mashhad.ir', port=443): Read timed out. (read timeout=20)`.

### 02-fhwa-walk

- URL: https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/section2.cfm
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:07:55.219887+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:07:55.623145+00:00`.
- اندازه body: `24293 bytes`؛ SHA-256: `34ee850b313cd42b6f878bfd5ba65109aed2ccf38a3776d8f73c9142025ac2c1`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/02-fhwa-walk.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/02-fhwa-walk.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ US federal agency publication; individual third-party credits must be checked; archived for private R&D.
- تاریخ انتشار: `1998-02`؛ این تاریخ، زمان دریافت نیست.
- دامنه شاهد: FHWA-HRT-98-107 (web label); report PDF cover FHWA-RD-98-107. Section 2.2: crossing design 1.2 m/s, 1.0 for specified older-population condition. Not observed Mashhad speed.

### 03-wiki-haft

- URL: https://en.wikipedia.org/wiki/Haft-e-Tir_Metro_Station_(Mashhad_Metro)
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:08:23.875455+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:08:24.452993+00:00`.
- اندازه body: `118055 bytes`؛ SHA-256: `07e08a7f4aa9b053563130ff42682bfd5f02800d667d4f150b4d07fc12e69378`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/03-wiki-haft.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/03-wiki-haft.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ Wikipedia page text generally CC BY-SA; verify embedded media separately. Private research discovery copy.
- دامنه شاهد: Secondary discovery only: trace exact original operator and municipality references; no station geometry authority

### 04-wiki-danesh

- URL: https://en.wikipedia.org/wiki/Danesh_Amuz_Metro_Station_(Mashhad_Metro)
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:08:26.503204+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:08:26.966760+00:00`.
- اندازه body: `116713 bytes`؛ SHA-256: `9ee37cc5d7fb75149b7b48a1b7d9a36e82d8161cd9bd5ef494bee54add160d18`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/04-wiki-danesh.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/04-wiki-danesh.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ Wikipedia page text generally CC BY-SA; verify embedded media separately. Private research discovery copy.
- دامنه شاهد: Secondary discovery only: trace exact original operator and municipality references; no station geometry authority

### 05-fhwa-course

- URL: https://www.fhwa.dot.gov/publications/research/safety/pedbike/05085/chapt8.cfm
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:08:27.246270+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:08:27.672042+00:00`.
- اندازه body: `67329 bytes`؛ SHA-256: `76da0a218cf083ee2aaf203bee9219f69bd4c9b2641bdd5ca2f6716f9141cc48`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/05-fhwa-course.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/05-fhwa-course.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ US federal agency publication; third-party credits may apply; private R&D copy.
- تاریخ انتشار: `2006-07`؛ این تاریخ، زمان دریافت نیست.
- دامنه شاهد: FHWA-HRT-05-099 Lesson 8. Section 8.4: historical design clearance speed versus heterogeneous measured walking speeds. Not current MUTCD and not station timing.

### 06-operator-buses-http

- URL: http://www.musroc.ir/Pages/Portal/RelatedBuses.aspx
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:09:52.524222+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:09:52.668997+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/06-operator-buses-http.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/06-operator-buses-http.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Original operator page cited by both station articles; related buses only, plans unknown
- خطا/محدودیت ثبت شده: `ConnectionError: HTTPConnectionPool(host='www.musroc.ir', port=80): Max retries exceeded with url: /Pages/Portal/RelatedBuses.aspx (Caused by NameResolutionError("HTTPConnection(host='www.musroc.ir', port=80): Failed to resolve 'www.musroc.ir' ([Errno -2] Name or service not known)"))`.

### 07-operator-buses-https

- URL: https://www.musroc.ir/Pages/Portal/RelatedBuses.aspx
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:09:54.719228+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:09:54.944854+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/07-operator-buses-https.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/07-operator-buses-https.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: HTTPS counterpart of station-reference operator URL; availability test
- خطا/محدودیت ثبت شده: `ConnectionError: HTTPSConnectionPool(host='www.musroc.ir', port=443): Max retries exceeded with url: /Pages/Portal/RelatedBuses.aspx (Caused by NameResolutionError("HTTPSConnection(host='www.musroc.ir', port=443): Failed to resolve 'www.musroc.ir' ([Errno -2] Name or service not known)"))`.

### 08-bus-map-pdf

- URL: https://bus.mashhad.ir//parameters/mashhad/modules/cdk/upload/content/file_manager/136/1406460232152s0fo6il5732gr6cio20vatkuf6.pdf
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:09:56.409637+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:10:16.960019+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/08-bus-map-pdf.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/08-bus-map-pdf.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Exact municipality PDF reference traced from both station pages; plan content unknown until fetched
- خطا/محدودیت ثبت شده: `ReadTimeout: HTTPSConnectionPool(host='bus.mashhad.ir', port=443): Read timed out. (read timeout=20)`.

### 09-metro-http

- URL: http://metro.mashhad.ir/
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:10:19.010456+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:10:39.488435+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/09-metro-http.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/09-metro-http.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: HTTP availability and redirect discovery after HTTPS timeout
- خطا/محدودیت ثبت شده: `ReadTimeout: HTTPConnectionPool(host='metro.mashhad.ir', port=80): Read timed out. (read timeout=20)`.

### 10-fhwa-freeflow

- URL: https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/section3.cfm
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:10:39.970866+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:10:40.432525+00:00`.
- اندازه body: `109244 bytes`؛ SHA-256: `d7adffddc7d89cf45ddff5aa072ad62921fd87a5d68e50aeee4ce41bcb49695b`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/10-fhwa-freeflow.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/10-fhwa-freeflow.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ US federal publication; third-party credits may apply. Private R&D archive.
- تاریخ انتشار: `1998-02`؛ این تاریخ، زمان دریافت نیست.
- دامنه شاهد: Section 3.3 Table 23 footnote c: pedestrian walkway free-flow reference 1.4 m/s; minimum versus actual travel time explicitly separated. Stairs table uses horizontal speed and LOS, not a local measurement.

### 11-murco-root

- URL: https://murco.mashhad.ir/
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:11:32.166026+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:11:52.596497+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/11-murco-root.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/11-murco-root.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Official urban-rail municipal domain discovered from Persian Mashhad metro article search; station-plan discovery
- خطا/محدودیت ثبت شده: `ReadTimeout: HTTPSConnectionPool(host='murco.mashhad.ir', port=443): Read timed out. (read timeout=20)`.

### 12-archive-operator

- URL: https://web.archive.org/web/20150714113237/http://www.musroc.ir/Pages/Portal/RelatedBuses.aspx
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:11:53.153303+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:11:58.941221+00:00`.
- اندازه body: `230458 bytes`؛ SHA-256: `f5143a32ca96988623ef12c8e14902cf81f45d028f037a0cad4771bf62471587`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/12-archive-operator.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/12-archive-operator.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- capture آرشیو: `2015-07-14T11:32:37Z`؛ وضعیت جاری را تأیید نمی کند.
- دامنه شاهد: Original public operator related-bus page. Both C1 station names present; historical buses not entrance mapping.

### 13-archive-map

- URL: https://web.archive.org/web/20190808215743/https://bus.mashhad.ir//parameters/mashhad/modules/cdk/upload/content/file_manager/136/1406460232152s0fo6il5732gr6cio20vatkuf6.pdf
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:12:00.991389+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:12:08.437396+00:00`.
- اندازه body: `2623478 bytes`؛ SHA-256: `3677de2f70d76abd3b01e4cb9b6bc200c9ac594f792429fcee3656a62f60dfda`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/13-archive-map.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/13-archive-map.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- capture آرشیو: `2019-08-08T21:57:43Z`؛ وضعیت جاری را تأیید نمی کند.
- دامنه شاهد: Municipal bus route guide, NOT a metro station plan. PDF creation metadata 2014-07-12T05:50:55Z is not publication date. No platform mapping extracted.

### 14-tourism-link-discovery

- URL: https://www.mashhad-tourist.ir/%D8%A7%D8%B7%D9%84%D8%A7%D8%B9%D8%A7%D8%AA-%D9%82%D8%B7%D8%A7%D8%B1-%D8%B4%D9%87%D8%B1%DB%8C-%D9%85%D8%B4%D9%87%D8%AF/
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:12:08.954680+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:12:12.918053+00:00`.
- اندازه body: `163827 bytes`؛ SHA-256: `5f954802c760014a6a6aea4a54adaa4d99fece89f6d842b7a8dbfd6eafc36e29`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/14-tourism-link-discovery.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/14-tourism-link-discovery.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Discovery-only links to municipality route/map service; not operator fare/calendar authority

### 15-municipal-map-root

- URL: https://map.mashhad.ir/
- روش: `GET`؛ HTTP: `None`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:12:38.591370+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:12:59.043694+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/15-municipal-map-root.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/15-municipal-map-root.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Municipality map service discovered through public tourism page hyperlink; targeted station entrance layer discovery only
- خطا/محدودیت ثبت شده: `ReadTimeout: HTTPSConnectionPool(host='map.mashhad.ir', port=443): Read timed out. (read timeout=20)`.

### 16-archive-station-map

- URL: https://web.archive.org/web/20150714113237/http://www.musroc.ir/Pages/Portal/Map.aspx
- روش: `GET`؛ HTTP: `302`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:13:41.583766+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:13:44.037201+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/16-archive-station-map.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/16-archive-station-map.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Public operator station/line map linked from retrieved historical page; seek C1 entrances and directional platforms; historical-only

### 17-archive-station-equipment

- URL: https://web.archive.org/web/20150714113237/http://www.musroc.ir/Pages/Portal/EquipmentsInStations.aspx
- روش: `GET`؛ HTTP: `302`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:13:46.087379+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:13:48.149190+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/17-archive-station-equipment.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/17-archive-station-equipment.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Public operator equipment/accessibility page linked from retrieved archive; historical-only station applicability must be explicit

### 18-archive-ticket

- URL: https://web.archive.org/web/20150714113237/http://www.musroc.ir/Pages/Portal/Ticket.aspx
- روش: `GET`؛ HTTP: `302`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:13:50.199454+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:13:52.508903+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/18-archive-ticket.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/18-archive-ticket.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Optional historical fare reference; not current prices or validated calendar

### 19-archive-station-map-capture

- URL: https://web.archive.org/web/20150722171314/http://www.musroc.ir/Pages/Portal/Map.aspx
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:14:13.777988+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:14:18.040736+00:00`.
- اندازه body: `90179 bytes`؛ SHA-256: `4407b5787a51c5dcb074486e418f4643c0861d07ec17969cd891ea421fce271d`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/19-archive-station-map-capture.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/19-archive-station-map-capture.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- capture آرشیو: `2015-07-22T17:13:14Z`؛ وضعیت جاری را تأیید نمی کند.
- دامنه شاهد: Original public operator map page embeds C1 station markers; point locations only, no entrance/platform/internal traversal mapping.

### 20-archive-station-equipment-capture

- URL: https://web.archive.org/web/20150709234224/http://www.musroc.ir/Pages/Portal/EquipmentsInStations.aspx
- روش: `GET`؛ HTTP: `401`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:14:20.090938+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:14:22.193427+00:00`.
- اندازه body: `16 bytes`؛ SHA-256: `123b263cbdff912e77daea63a3c0c1c68639a59e3bb021bf3f40b7b17d35ce7a`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/20-archive-station-equipment-capture.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/20-archive-station-equipment-capture.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Follow observed archive Location for operator access equipment; capture date 2015-07-09, publication unknown
- خطا/محدودیت ثبت شده: `http_401`.

### 21-archive-ticket-capture

- URL: https://web.archive.org/web/20150722170256/http://www.musroc.ir/Pages/Portal/Ticket.aspx
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:14:24.243714+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:14:27.114162+00:00`.
- اندازه body: `67999 bytes`؛ SHA-256: `a2d81dddd4aa52e463950ca03150fbc7c3bb9f6a68c2ef29fc23e47620b482b9`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/21-archive-ticket-capture.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/21-archive-ticket-capture.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- capture آرشیو: `2015-07-22T17:02:56Z`؛ وضعیت جاری را تأیید نمی کند.
- دامنه شاهد: Historical ticket page links a fare image; image not acquired/read. No verified fare amount or current validity.

### 22-fhwa-full-report

- URL: https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/98107.pdf
- روش: `GET`؛ HTTP: `200`؛ موفقیت دریافت محتوا: `true`.
- شروع UTC: `2026-11-02T20:16:25.064205+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:16:25.690423+00:00`.
- اندازه body: `610795 bytes`؛ SHA-256: `6100c9b590c24314f299450c6fbb1fa7c576be45c3756182dd03eafe951dc67b`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/22-fhwa-full-report.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/22-fhwa-full-report.metadata.json`.
- مجوز/حقوق: source-noted distribution; see rightsNote؛ PDF technical documentation page declares no distribution restrictions and public NTIS availability; third-party credits not exhaustively assessed. Private R&D archival copy.
- تاریخ انتشار: `1998-02`؛ این تاریخ، زمان دریافت نیست.
- دامنه شاهد: Complete author-authored NCSU final report for FHWA: Rouphail, Hummer, Milazzo II, Allen. Cover report ID FHWA-RD-98-107. Documentation page distribution statement: no restrictions. Not a Mashhad calibration.

### 23-archive-catalogs

- URL: https://web.archive.org/web/20150722171314/http://www.musroc.ir/Pages/Portal/Catalogs.aspx
- روش: `GET`؛ HTTP: `302`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:16:44.681540+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:16:46.164038+00:00`.
- اندازه body: `0 bytes`؛ SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/23-archive-catalogs.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/23-archive-catalogs.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Observed public brochure/catalogue navigation on official operator map page; seek station-internal diagrams only

### 24-archive-catalogs-capture

- URL: https://web.archive.org/web/20150722171815/http://www.musroc.ir/Pages/Portal/Catalogs.aspx
- روش: `GET`؛ HTTP: `401`؛ موفقیت دریافت محتوا: `false`.
- شروع UTC: `2026-11-02T20:16:58.065788+00:00`؛ پایان/دریافت UTC: `2026-11-02T20:17:00.081205+00:00`.
- اندازه body: `16 bytes`؛ SHA-256: `123b263cbdff912e77daea63a3c0c1c68639a59e3bb021bf3f40b7b17d35ce7a`.
- raw بایگانی خصوصی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/24-archive-catalogs-capture.body`؛ metadata اصلی: `/var/backups/besrah/r2bd1-resume-20261102T200724Z/official-research/24-archive-catalogs-capture.metadata.json`.
- مجوز/حقوق: unknown؛ Rights not declared/unknown; public response archived for private R&D only.
- دامنه شاهد: Follow observed archive Location for public operator brochures; historical data only, not live station validation
- خطا/محدودیت ثبت شده: `http_401`.

## مدل زمانی و تاریخ اعتبار

- گزارش FHWA سال ۱۹۹۸ فقط مرجع تاریخی سرعت حرکت آزاد و جدایی زمان حرکت از تأخیر است؛ استاندارد جاری، سرعت واقعی مشهد یا زمان دسترسی داخل ایستگاه معرفی نشده است.[15][27]
- marker های اپراتور با capture سال ۲۰۱۵ فقط موقعیت نمایشی ایستگاه هستند؛ ورودی، سکو و اتصال امروز را تأیید نمی کنند.[24]
- صفحه بلیت قدیمی تصویر تعرفه را لینک می کند؛ تصویر استخراج/خوانده نشده و مبلغ یا اعتبار جاری پذیرفته نشده است.[26]
- `unknown` بودن تعرفه مانع مستقل Gate زمان محور نیست؛ تقویم تاریخ آزمون آینده باید جداگانه مشخص شود.

## بازتولید و کنترل

```bash
python3 scripts/r2bd1/derive.py data/geospatial/r2bd1-c1-v1
python3 scripts/r2bd1/build_evidence.py
python3 -m unittest discover -s tests/data -p "test_r2bd1_*.py" -v
(cd data/geospatial/r2bd1-c1-v1 && sha256sum -c SHA256SUMS)
```

بازتولید آفلاین باید از raw موجود استفاده کند. تکرار دانلود، ممکن است نسخه جدید منبع بدهد؛ در این صورت sourceId/نسخه تازه لازم است، نه بازنویسی raw فعلی. fetch موفق قدیمی به عنوان مشاهده زنده معرفی نمی شود.

## Sources

[15] https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/section3.cfm — 10-fhwa-freeflow
[24] https://web.archive.org/web/20150722171314/http://www.musroc.ir/Pages/Portal/Map.aspx — 19-archive-station-map-capture
[26] https://web.archive.org/web/20150722170256/http://www.musroc.ir/Pages/Portal/Ticket.aspx — 21-archive-ticket-capture
[27] https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/98107.pdf — 22-fhwa-full-report
