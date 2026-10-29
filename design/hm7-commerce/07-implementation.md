# پیاده‌سازی در وردپرس و ووکامرس

## فایل‌ها

- `tokens.css` (همین سیستم)، `bundle.css`، `bundle.js` و پوشهٔ `fonts/` را در `/wp-content/uploads/hm7/` بگذارید. هیچ درخواستی به CDN نیست.
- پوستهٔ پروژه (رنگ و فونت) یک فایل کوچک جدا بعد از `tokens.css`.

## تزریق با Code Snippets Pro

همهٔ منطق در snippet ها، بدون تغییر فایل‌های پوسته یا افزونه:

```php
add_action('wp_enqueue_scripts', function () {
  $u = content_url('uploads/hm7/'); $v = '1.1.0';
  wp_enqueue_style('hm7-tokens', $u . 'tokens.css', [], $v);
  wp_enqueue_style('hm7', $u . 'bundle.css', ['hm7-tokens'], $v);
  wp_enqueue_script('hm7', $u . 'bundle.js', [], $v, ['in_footer' => true, 'strategy' => 'defer']);
}, 20);
add_action('wp_head', function () {
  echo '<link rel="preload" href="' . esc_url(content_url('uploads/hm7/fonts/AzarMehr-Regular.woff2')) . '" as="font" type="font/woff2" crossorigin>';
}, 1);
add_filter('language_attributes', function ($a) { return $a . ' data-theme="light"'; });
```

- `data-theme` را از ترجیح کاربر (کوکی) بدهید تا صفحه بدون چشمک تم درست باز شود.
- قالب‌های ووکامرس را با `template_include` (اولویت بالا، مثلاً ۹۹۹۹) به قالب‌های خودتان ببرید و کلاس‌های `cm-*` را در همان قالب‌ها بگذارید؛ منطق داده دست نخورد.

## راه‌اندازی

- `HM7.init(document)` بعد از `DOMContentLoaded` — همهٔ رفتارها داخل همین بسته شوند؛ هندلری که بیرون از آن تعریف شود ممکن است پیش از ساخت DOM اجرا شود.
- بعد از هر تکهٔ AJAX (فیلتر، اسکرول بی‌پایان، fragment های سبد، پاپ‌آپ المنتور) دوباره `HM7.init(container)`؛ تکراری وصل نمی‌کند.

## رویدادهای ووکامرس

```js
jQuery(document.body).on('added_to_cart', function (e, fragments, hash, $btn) {
  var btn = $btn && $btn[0], card = btn && btn.closest('[data-cm-product]');
  HM7.shop.fly(card && card.querySelector('.cm-product__media'), document.querySelector('[data-cm-cart]'), {
    onArrive: function () { HM7.shop.toast(document.querySelector('.cm-toasts'), { title: 'به سبد افزوده شد', text: btn.getAttribute('aria-label') || '', action: 'مشاهدهٔ سبد', onAction: function () { location.href = wc_add_to_cart_params.cart_url; } }); }
  });
});
jQuery(document.body).on('updated_cart_totals wc_fragments_refreshed', function () { HM7.init(document); });
```

- حذف ردیف سبد: اول انیمیشن (`api.dissolve()`)، هم‌زمان درخواست AJAX؛ اگر رد شد، `api.restore()` و پیام.
- تعداد: `HM7.shop.qty(el, { onChange })` با debounce ۴۰۰ms به `update_cart`.

## نگاشت کلاس‌ها

| ووکامرس | این سیستم |
| --- | --- |
| `ul.products li.product` | `article.cm-product[data-cm-product]` |
| `.price del` / `.price ins` | `.cm-price__was s` / `.cm-price__now b` |
| `.onsale` | `.cm-badge.cm-badge--sale` |
| `.add_to_cart_button` | `.cm-btn.cm-add[data-cm="add"]` (همان کلاس ووکامرس را هم نگه دارید) |
| `.quantity input.qty` | `[data-cm="qty"]` + input مخفی همگام |
| `.woocommerce-cart-form__cart-item` | `.hm7-notif-row > .hm7-notif.cm-line` |
| `.woocommerce-message` | `HM7.shop.toast` |
| `.woocommerce-error` | `.cm-field.is-error` کنار همان فیلد |

## المنتور

- ویجت HTML یا کلاس CSS سفارشی روی سکشن‌ها: `hm7-stage` برای هیرو، `cm-card` برای ستون‌ها. محتوا از ویرایشگر قابل‌تغییر بماند؛ فقط ظاهر و رفتار از سیستم بیاید.
- بعد از باز شدن پاپ‌آپ: `jQuery(document).on('elementor/popup/show', function (e, id, inst) { HM7.init(inst.$element[0]); })`.

## صدا و لرزش

- پیش‌فرض خاموش؛ یک سوییچ در «حساب ← تنظیمات» به `HM7.sound.enable(on)` و `HM7.haptics.enable(on)` وصل شود (انتخاب در localStorage می‌ماند).
- رویدادهای ووکامرس صدای خودشان را از `HM7.shop` می‌گیرند (افزودن، تعداد، حذف)؛ برای رویداد سرور، مثل نوبت رسیدن در صف انتظار، `HM7.cue('toast')` را در همان کدی صدا بزنید که toast را می‌سازد.
- برای آنالیتیکس یا لرزش سفارشی: `HM7.onCue(function (name, data, el) { … })` یا رویداد DOM `hm7:cue`.

## فونت‌ها

- AzarMehr ۴۰۰ تا ۹۰۰، JetBrains Mono ۴۰۰ و ۷۰۰، HMSymbol متغیر — همه `woff2`، `font-display: swap` (آیکون `block`).
- برای پروژه‌ای با فونت دیگر (Dana، Vazirmatn، IRANSansX، Peyda) فقط `--font-sans` و `@font-face` خودتان را بدهید.

## کارایی

- بودجه: `bundle.js` حدود ۴۲KB (با موتور صدا و لایهٔ Liquid Glass) و `bundle.css` با همهٔ آیکون‌ها حدود ۳۹KB (gzip). صداها فایل نیستند و حجمی اضافه نمی‌کنند. اگر به همهٔ ۲۴۸۵ نماد نیاز ندارید، کلاس‌های `.hms-*` استفاده‌نشده را در ساخت حذف کنید.
- `backdrop-filter` فقط روی لایه‌های شناور؛ تصویرهای محصول `loading="lazy"` و `decoding="async"` با `width/height`.
- انیمیشن‌ها فقط `transform` و `opacity`؛ موتور بیرون از دید متوقف می‌شود.
