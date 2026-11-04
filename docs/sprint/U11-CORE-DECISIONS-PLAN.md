# U11 | Intelligence Core روی مسیر و خرید (فاز ۳) (فقط برنامه؛ اجرا نشده)

**این سند مجوز اجرا نیست.** نیازمند `PRODUCTION_DEPLOY_GO U11`. plan با hash: `plan-u11-core-decisions.json` (۱۱ فایل: ۵ dist، ۶ assets؛ ۰ ناهمخوانی pre-state با Production زنده). بدون Nginx و systemd (مسیرهای قبلی `/api/trip` همان اند؛ فقط کلیدهای `priority` و بلوک `decision` اضافه شده اند).

## چه چیزی عوض می شود
- `POST /api/trip`: کلید اختیاری `priority` (`time|walk|balanced|cost`) و پاسخ با بلوک `decision` (برچسب، توضیح Core، پرسش مفید، یادداشت).
- `decision/trip.ts`: گزینه های برنامه ریز ← Candidate با Evidence ← `evaluateDecision` (Core واقعی). هزینه همیشه unknown. با یک گزینه هیچ برچسبی نمی خورد.
- UI مسیر: برچسب «سریع ترین / هماهنگ با اولویت شما»، پرسش «کدام برایتان مهم تر است؟» فقط برای یک مبادلهٔ واقعی؛ پاسخ ترجیح محلی می شود.
- پروفایل: اولویت «پیاده روی کمتر / هر دو»؛ بسفود و بسپی: سقف غذا و کالا از پروفایل نقطهٔ شروع جست وجو.
- بسپی: Core فقط پیشنهادهای resolved یک کالا را می سنجد و «کم هزینه ترین پیشنهاد ثبت شده» می دهد (≥۲ پیشنهاد، عکس کمتر از ۷۲ ساعت).

## اجرا و بازگشت
checkpoint ← `apply --group dist` ← **یک restart** ← `apply --group assets` ← verify post + hash عمومی. بازگشت: assets، سپس dist و یک restart.
