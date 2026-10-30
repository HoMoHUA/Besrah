// Product registry shared by global discovery, service cards and device-local saves.
// Besrah is ONE transport service (metro + bus); Besfood and Bespay are separate sibling services.
import { normalize } from './logic.js';
export const SERVICES = [
  { id: 'besrah', title: 'بسراه', subtitle: 'حمل و نقل شهری', status: 'live', logo: 'assets/services/besrah.svg', keywords: 'مترو اتوبوس ریل خط ایستگاه رفت و آمد',
    blurb: 'مترو و اتوبوس مشهد: ایستگاه نزدیک، برآورد زمان مترو، خط ها و ایستگاه های اتوبوس.', action: { type: 'view', view: 'metro' } },
  { id: 'food', title: 'بسفود', subtitle: 'سفارش غذا', status: 'soon', logo: 'assets/services/food.svg', keywords: '',
    blurb: 'سفارش غذا از اطراف شما؛ این سرویس هنوز در دسترس نیست.' },
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
