// Product registry shared by global discovery, service cards and device-local saves.
import { normalize } from './logic.js';
export const SERVICES = [
  { id: 'metro', title: 'ریل', subtitle: 'مترو مشهد', status: 'live', logo: 'assets/services/rail.svg',
    blurb: 'خط ۱ و خط ۲، ایستگاه نزدیک و برآورد زمان رسیدن؛ همه در یک جا.', action: { type: 'view', view: 'metro' } },
  { id: 'bus', title: 'کاروان', subtitle: 'اتوبوس شهری', status: 'soon', logo: 'assets/services/caravan.svg',
    blurb: 'راهنمای خطوط و ایستگاه های اتوبوس؛ این سرویس هنوز در دسترس نیست.' },
  { id: 'route', title: 'راهیاب', subtitle: 'مسیریابی ترکیبی', status: 'soon', logo: 'assets/services/rahyab.svg',
    blurb: 'پیدا کردن مسیر با چند روش جابه جایی؛ این سرویس هنوز در دسترس نیست.' },
  { id: 'taxi', title: 'سوار', subtitle: 'تاکسی اینترنتی', status: 'soon', logo: 'assets/services/savar.svg',
    blurb: 'پیوند به برنامه های تاکسی اینترنتی؛ این سرویس هنوز در دسترس نیست.' },
];
export const isLive = service => service?.status === 'live';
export function homeLayout(services = SERVICES) {
  return { primary: services.slice(0, 3), secondary: services.slice(3, 6), more: services.slice(6), moreCount: Math.max(0, services.length - 6) };
}
export function filterServices(query, services = SERVICES) {
  const key = normalize(query ?? '');
  return services.filter(s => !key || normalize(s.title + ' ' + s.subtitle).includes(key));
}
