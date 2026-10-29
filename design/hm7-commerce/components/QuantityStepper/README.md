انتخاب تعداد: عدد با غلتیدن عوض می‌شود؛ در کمترین مقدار، «−» به سطل تبدیل می‌شود.

- `[data-cm="qty"]` با `data-min`، `data-max`، `data-value` و `data-removable`؛ یا `HM7.shop.qty(el, { onChange, onRemove, onMax })` → `{ value, set(n) }`.
- ترتیب RTL: «+» راست، عدد، «−» چپ. دکمه‌ها ۳۴px داخل کپسول ۴۰px؛ کلیدهای بالا/پایین هم کار می‌کنند.
- `data-removable`: در `min`، «−» با Icon Morph سطل قرمز می‌شود و `onRemove` می‌دهد (در سبد، ردیف را با شن حذف کنید).
- سقف: «+» غیرفعال، عدد یک لرزش ۳۸۰ms و `onMax` برای پیام «حداکثر ۳ عدد».
