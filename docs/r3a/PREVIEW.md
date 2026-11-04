# اجرای Preview مستقل R3-A

این Preview از موتور و داده واقعی مدل استفاده می کند؛ موقعیت زنده، داده میدانی جدید، انتشار Production یا PASS گوشی واقعی نیست. بازخورد در همه حالت ها بسته است؛ هیچ store نوشتنی ساخته نمی شود.

## اجرا روی همین سرور

```bash
cd /root/projects/besrah-r3a
npm --prefix packages/core run build
node scripts/preview-unified-metro.mjs --port=18881 --mode=on
```

نشانی: `http://127.0.0.1:18881/app/`. از خانه، «بسراه / حمل و نقل شهری» را انتخاب کنید، سپس ورود اختیاری را انجام دهید. اگر ساعت فعلی خارج از سرویس بود، روز بعد و ساعت ۱۰:۰۰ تهران را برای آزمون انتخاب کنید. این ساعت فقط ورودی آزمون است، نه اعلام ساعت فعالیت واقعی.

حالت های جداگانه:

```bash
node scripts/preview-unified-metro.mjs --port=18882 --mode=off
node scripts/preview-unified-metro.mjs --port=18883 --mode=strict
```

هر حالت مستقل است. `off` نسخه فعلی تابلو/مترو را بدون کارت غیرفعال نگه می دارد. `strict` برای روز فاقد تقویم معتبر نتیجه ناکافی می دهد، نه زمان ساختگی. کنترل Production و environment آن هیچ نقشی در این Preview ندارند؛ `switchFile:null` و `feedbackDir:null` صریح هستند.

## مشاهده از رایانه مالک، بدون انتشار عمومی

از رایانه خودتان با اتصال SSH مجاز، تونل بسازید؛ نام میزبان و کاربر SSH خودتان را جایگزین کنید:

```bash
ssh -N -L 18881:127.0.0.1:18881 -p <SSH_PORT> root@<VPS_HOST>
```

سپس در مرورگر همان رایانه `http://127.0.0.1:18881/app/` را باز کنید. این تونل و Chromium، آزمون Telegram WebView گوشی محسوب نمی شوند. برای گوشی واقعی در مرحله بعد به مسیر دسترسی خصوصی یا پنجره Production با مجوز تازه نیاز است؛ این مأموریت چنین انتشاری ندارد.

## تست واقعی HTTP و runner

پس از اجرای سه Preview:

```bash
node --test --test-concurrency=1 tests/release/preview-unified-metro.test.mjs
# برای parity با نسخه قبلی، baseline موقت زیر را نیز اجرا کنید:
node scripts/preview-unified-metro.mjs --port=18880 --mode=on --runtime-root=/root/projects/besrah-r2apb
python3 tests/r3a/test_preview_http.py
```

آزمون HTTP فقط پورت های loopback توسعه را می پذیرد؛ به Production درخواست بازخورد یا بار تست نمی فرستد. `/next` و `trains` برای زمان ثابت با baseline واقعی مقایسه می شوند. پاسخ شبِ بدون نتیجه در تقویم ناقص، صادقانه `insufficient_data` است؛ `no_feasible_option` به عنوان fixture صریح رابط آزموده می شود، نه با تغییر موتور برای سبز شدن تست.

## منابع و توقف

rate limit، concurrency و پنجره ۱۲۰ دقیقه ای همان پیش فرض موتور هستند؛ برای UI تست شل نشده اند. ورودی های سفر فقط در حافظه همین نشست هستند؛ انتخاب opt-in فعلی ممکن است طبق قرارداد موجود در دستگاه ذخیره شود، نه تاریخچه سفر.

برای پایان Preview، در ترمینال خودش `Ctrl+C` بزنید. فقط همین process بسته می شود؛ `besrah-core`، Nginx، n8n و بات ها دست نخورده می مانند. راه اندازی مجدد، کپی به `/srv/besrah` یا فعال سازی flag Production بخشی از این دستور نیست.
