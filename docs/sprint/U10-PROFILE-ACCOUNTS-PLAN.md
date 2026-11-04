# U10 | خانهٔ مقصد محور، پیشنهاد حالا، تب پروفایل و حساب اختیاری (فقط برنامه؛ اجرا نشده)

**این سند مجوز اجرا نیست.** نیازمند `PRODUCTION_DEPLOY_GO U10`. plan با hash: `plan-u10-profile-accounts.json` (۱۹ فایل: dist و assets؛ ۰ ناهمخوانی pre-state با Production زنده).

## اجرا (بر پایهٔ RELEASE-RUNBOOK)
1. checkpoint (`/srv/besrah` + site Nginx + drop-inها) و بازیابی آزمایی.
2. Nginx: کپی `deploy/nginx/besrah-account-post.conf` به snippets + یک خط include کنار `besrah-trip-post.conf`، `nginx -t`، `reload`. بدون این مرحله UI پروفایل «ورود فعلاً در دسترس نیست» نشان می دهد و پیشنهاد خانه پنهان می شود (بقیهٔ برنامه سالم).
3. systemd: کپی `deploy/systemd/besrah-core-account.conf` به `besrah-core.service.d/account.conf` + `daemon-reload` (ایجاد `/var/lib/besrah-account` با ۰۷۰۰ توسط systemd).
4. `apply --group dist` ← **یک restart** ← بررسی: `GET /api/account/session` = guest، `POST /api/recommendations/home` = 200، پایگاه ساخته شد.
5. `apply --group assets` ← verify post ← hash عمومی.
6. حافظه باید زیر ۱۵۰ MiB بماند؛ `node:sqlite` فقط هنگام اولین استفاده از حساب باز می شود.

## بازگشت
assets ← dist + یک restart ← حذف drop-in و include ← reload. فایل `accounts.db` جدا و دست نخورده می ماند (حذفش فقط با دستور مالک).

## تأیید مالک روی گوشی (AWAITING_HUMAN)
از `@Besrahbot`: ورود با تلگرام در پروفایل، ماندن نشست پس از بستن و باز کردن، روشن/خاموش کردن همگام سازی، «ایستگاه نزدیک من»، مقصد محور بودن خانه.
