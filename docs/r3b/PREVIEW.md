# اجرای Preview مستقل R3-B

Preview از موتور و داده واقعی مدل استفاده می‌کند؛ موقعیت زنده، داده میدانی جدید، انتشار Production یا PASS گوشی واقعی نیست. بازخورد در همه حالت‌ها بسته است. فقط loopback؛ هیچ public ingress ساخته نشده است.

```bash
cd /root/projects/besrah-r3b          # شاخه feature/r3b-product-ux
git rev-parse HEAD                     # باید با HEAD گزارش شما یکی باشد
npm --prefix packages/core run build
node scripts/preview-unified-metro.mjs --port=18891 --mode=on
node scripts/preview-unified-metro.mjs --port=18892 --mode=off     # بازدیدکننده عادی، Beta خاموش
node scripts/preview-unified-metro.mjs --port=18893 --mode=strict  # تقویم strict، نتیجه ناکافی
```

مشاهده از رایانه خودتان با تونل SSH (مجاز و فقط برای شما):

```bash
ssh -N -L 18891:127.0.0.1:18891 -p <SSH_PORT> root@<VPS_HOST>
# سپس در مرورگر: http://127.0.0.1:18891/app/   ← «بسراه / حمل و نقل شهری» ← «ورود اختیاری به سفر آزمایشی»
```

- فایل‌های Mini App مستقیم از worktree خوانده می‌شوند؛ پس از تغییر CSS/JS فقط صفحه را تازه کنید. تغییر در `packages/core` نیاز به build و راه‌اندازی دوباره Preview دارد.
- برای نتیجه مدل در شب، «انتخاب زمان»، روز بعد و ساعت ۱۰:۰۰ را بگذارید. ساعت فقط ورودی آزمون است.
- برای پایان: `Ctrl+C` در ترمینال همان Preview یا `kill` فقط همان PID؛ `besrah-core`، Nginx، n8n و بات‌ها دست‌نخورده می‌مانند.
- آزمون‌ها: `node --test --test-concurrency=1 apps/miniapp/*.test.mjs`؛ برای HTTP واقعی با این پورت‌ها: `R3A_ON_PORT=18891 R3A_OFF_PORT=18892 R3A_STRICT_PORT=18893 R3A_BASE_PORT=<baseline از R2a-PB> python3 tests/r3a/test_preview_http.py`.
