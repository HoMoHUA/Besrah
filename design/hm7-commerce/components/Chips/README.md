چیپ‌های فیلتر: با انتخاب، پر می‌شوند و تیک از داخلشان می‌روید؛ فیلتر فعال با یک لمس به شن تبدیل می‌شود.

- صفحه: `button.cm-chip[data-cm-toggle]` با `aria-pressed`؛ `HM7.init` تیک `.cm-chip__check` را اضافه می‌کند (عرض ۰ → ۱۶px با فنر). شمارنده با `.cm-chip__count`.
- صحنه: `.hm7-glass.hm7-chip[data-hm7-toggle]`.
- فیلترهای فعال بالای فهرست با دکمهٔ ✕؛ حذف با `HM7.dissolve(chip, { collapse: false })` و بعد از پایان، حذف از DOM.
- ارتفاع ۳۶px (`control-sm`)، فاصله `space-8`. در موبایل یک ردیف افقی قابل اسکرول، نه چندخطی.
