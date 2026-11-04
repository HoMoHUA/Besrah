// Product registry shared by global discovery, service cards and device-local saves.
// Besrah is ONE transport service (metro + bus); Besfood and Bespay are separate sibling services.
import { normalize } from './logic.js';
export const SERVICES = [
  { id: 'besrah', title: 'بسراه', subtitle: 'حمل و نقل شهری', status: 'live', logo: 'assets/services/besrah.svg', keywords: 'مترو اتوبوس ریل خط ایستگاه رفت و آمد',
    blurb: 'مترو و اتوبوس مشهد: ایستگاه نزدیک، برآورد زمان مترو، خط ها و ایستگاه های اتوبوس.', action: { type: 'view', view: 'metro' } },
  { id: 'food', title: 'بسفود', subtitle: 'سفارش غذا', status: 'live', logo: 'assets/services/food.svg', keywords: 'غذا رستوران اسنپ تپسی منو کافه فست فود',
    blurb: 'پیشنهاد هوشمند رستوران ها و کافه های اطراف ایستگاه های مترو و موقعیت مکانی شما با مقایسه حداقل سفارش.', action: { type: 'view', view: 'food' } },
  { id: 'trip', title: 'رهیاب', subtitle: 'مسیر مکان به مکان', status: 'live', logo: 'assets/services/rahyab.svg', keywords: 'مسیر مسیریابی مبدأ مقصد خودرو پیاده نشانی',
    blurb: 'مسیر از یک مکان به مکان دیگر با مترو، خودرو یا پیاده؛ هر زمان با منشأ و میزان قطعیتش.', action: { type: 'view', view: 'trip' } },
  { id: 'shop', title: 'بسخرید', subtitle: 'مقایسهٔ قیمت کالا', status: 'live', logo: 'assets/services/shop.svg', keywords: 'خرید کالا قیمت مقایسه فروشنده هدفون ساعت پاوربانک',
    blurb: 'مقایسهٔ قیمت ثبت شدهٔ چند کالای منتخب میان فروشندگان، با منشأ و زمان هر قیمت.', action: { type: 'view', view: 'shop' } },
  { id: 'pay', title: 'بسپی', subtitle: 'پرداخت و کیف پول', status: 'soon', logo: 'assets/services/pay.svg', keywords: '',
    blurb: 'پرداخت و کیف پول بِسراه؛ این سرویس هنوز در دسترس نیست.' },
];
export const isLive = service => service?.status === 'live';
export function homeLayout(services = SERVICES) {
  return { primary: services.slice(0, 3), secondary: services.slice(3, 6), more: services.slice(6), moreCount: Math.max(0, services.length - 6) };
}
export function filterServices(query, services = SERVICES) {
  const key = normalize(query ?? '');
  return services.filter(s => !key || normalize(s.title + ' ' + s.subtitle + ' ' + (s.keywords ?? '')).includes(key));
}
