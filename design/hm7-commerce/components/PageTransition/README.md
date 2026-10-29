از HoMoGram v1.6: انتقال از فهرست محصولات به صفحهٔ محصول و برگشت، به سبک HarmonyOS.

- باز کردن: فهرست به `scale(.92)` و شفافیت ۰٫۱۸ می‌رود؛ صفحهٔ محصول از کنار وارد می‌شود (۴۲۰ms `--sm`)؛ بخش‌ها پله‌پله با ۳۵ms فاصله.
- `HM7.ui.pages().open(main, next, { stagger: '.st' })` و `.back(main, next)`. هر دو صفحه `.page` داخل یک ظرف `position: relative; overflow: hidden`.
- در وب واقعی با View Transitions یا بارگذاری AJAX ترکیب کنید و آدرس را با `history.pushState` عوض کنید.
