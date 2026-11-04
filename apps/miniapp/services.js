// Product registry shared by global discovery, service cards and device-local saves.
// Besrah is ONE transport service (metro + bus); Besfood and Bespay are separate sibling services.
import { normalize } from './logic.js';
export const SERVICES = [
  { id: 'besrah', title: 'بسراه', subtitle: 'مترو، اتوبوس و مسیر', status: 'live', logo: 'assets/services/besrah.svg', keywords: 'مترو اتوبوس ریل خط ایستگاه رفت و آمد مسیر مسیریابی مبدأ مقصد خودرو پیاده نشانی',
    blurb: 'مترو و اتوبوس مشهد و مسیر مکان به مکان با مترو، خودرو یا پیاده؛ هر زمان با منشأ و میزان قطعیتش.', action: { type: 'view', view: 'metro' } },
  { id: 'food', title: 'بسفود', subtitle: 'سفارش غذا', status: 'live', logo: 'assets/services/food.svg', keywords: 'غذا رستوران اسنپ تپسی منو کافه فست فود',
    blurb: 'جست وجوی غذا در رستوران ها و کافه های مشهد با قیمت های ثبت شده، منوی کامل و پیوند سفارش.', action: { type: 'view', view: 'food' } },
  { id: 'pay', title: 'بسپی', subtitle: 'مقایسهٔ قیمت و پرداخت', status: 'live', logo: 'assets/services/pay.svg', keywords: 'خرید کالا قیمت مقایسه فروشنده هدفون ساعت پاوربانک پرداخت کیف پول',
    blurb: 'مقایسهٔ قیمت ثبت شدهٔ چند کالای منتخب میان فروشندگان، با منشأ و زمان هر قیمت. پرداخت و کیف پول به زودی.', action: { type: 'view', view: 'shop' } },
];
export const isLive = service => service?.status === 'live';
export function homeLayout(services = SERVICES) {
  return { primary: services.slice(0, 3), secondary: services.slice(3, 6), more: services.slice(6), moreCount: Math.max(0, services.length - 6) };
}
export function filterServices(query, services = SERVICES) {
  const key = normalize(query ?? '');
  return services.filter(s => !key || normalize(s.title + ' ' + s.subtitle + ' ' + (s.keywords ?? '')).includes(key));
}
