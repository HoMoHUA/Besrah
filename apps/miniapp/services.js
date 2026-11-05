// Product registry shared by global discovery, service cards and device-local saves.
// Besrah is ONE transport service (metro + bus); Besfood and Bespay are separate sibling services.
import { normalize } from './logic.js';
export const SERVICES = [
  { id: 'besrah', title: 'بسراه', subtitle: 'مترو، اتوبوس و مسیر', status: 'live', logo: 'assets/services/besrah.svg', keywords: 'مترو اتوبوس ریل خط ایستگاه رفت و آمد مسیر مسیریابی مبدأ مقصد خودرو پیاده نشانی',
    blurb: 'مترو و اتوبوس مشهد و مسیر مکان به مکان با مترو، خودرو یا پیاده؛ هر زمان با منشأ و میزان قطعیتش.', action: { type: 'view', view: 'metro' } },
  { id: 'food', title: 'بسفود', subtitle: 'غذا، کافه و فروشگاه', status: 'live', logo: 'assets/services/food.svg', keywords: 'غذا رستوران اسنپ تپسی منو کافه فست فود شیرینی قنادی کیک گل فروشی سوپرمارکت نانوایی',
    blurb: 'جست‌وجوی دسته‌بندی‌شدهٔ رستوران، کافه، شیرینی، گل و خرید روزمره در مشهد با قیمت ثبت‌شده و لینک فروشنده.', action: { type: 'view', view: 'food' } },
  { id: 'pay', title: 'بسخرید', subtitle: 'جست‌وجو و مقایسه کالا', status: 'live', logo: 'assets/services/pay.svg', keywords: 'بسخرید خرید کالا قیمت مقایسه فروشنده هدفون ساعت پاوربانک خرید اقتصادی',
    blurb: 'مقایسهٔ قیمت ثبت‌شدهٔ کالاهای منتخب در فروشندگان موجود؛ سرویس کیف پول بسپی جداگانه در آینده توسعه می‌یابد.', action: { type: 'view', view: 'shop' } },
];
export const isLive = service => service?.status === 'live';
export function homeLayout(services = SERVICES) {
  return { primary: services.slice(0, 3), secondary: services.slice(3, 6), more: services.slice(6), moreCount: Math.max(0, services.length - 6) };
}
export function filterServices(query, services = SERVICES) {
  const key = normalize(query ?? '');
  return services.filter(s => !key || normalize(s.title + ' ' + s.subtitle + ' ' + (s.keywords ?? '')).includes(key));
}
