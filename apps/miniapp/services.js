// One list drives the home tiles, the services tab and the roadmap sheet.
// `status: 'live'` = built and working; `'soon'` = not built (no action, no screen, no date).
export const SERVICES = [
  { id: 'metro1', status: 'live', title: 'مترو خط ۱', icon: 'subway', tint: '215,255,99',
    blurb: 'برآورد زمان رسیدن قطار بعدی در ایستگاه های خط ۱ بر پایهٔ برنامهٔ حرکت.', action: { type: 'view', view: 'stations', mode: 'line1' } },
  { id: 'nearest', status: 'live', title: 'نزدیک ترین ایستگاه', icon: 'location_north_up_right_circle_fill', tint: '130,232,255',
    blurb: 'با اجازهٔ شما، نزدیک ترین ایستگاه روی همین دستگاه پیدا می شود؛ مختصات ارسال یا ذخیره نمی شود.', action: { type: 'locate' } },
  { id: 'stations', status: 'live', title: 'ایستگاه ها', icon: 'list_bullet', tint: '111,240,210',
    blurb: 'جست وجو و فهرست همهٔ ایستگاه ها، با ترتیب خط ۱.', action: { type: 'view', view: 'stations', mode: 'all' } },
  { id: 'line2', status: 'soon', title: 'خط ۲', icon: 'subway_fill', tint: '255,190,74', blurb: 'زمان رسیدن قطار خط ۲ هنوز ساخته نشده است.' },
  { id: 'bus', status: 'soon', title: 'اتوبوس', icon: 'bus_fill', tint: '255,150,214', blurb: 'اطلاعات اتوبوس هنوز ساخته نشده است.' },
  { id: 'route', status: 'soon', title: 'مسیریابی ترکیبی', icon: 'route_plan', tint: '170,180,255', blurb: 'مسیر ترکیبی مترو، پیاده روی و تاکسی هنوز ساخته نشده است.' },
  { id: 'taxi', status: 'soon', title: 'پیوند به تاکسی اینترنتی', icon: 'car_fill', tint: '255,170,120', blurb: 'اتصال به برنامه های تاکسی اینترنتی هنوز ساخته نشده است.' },
  { id: 'messengers', status: 'soon', title: 'پیام رسان های دیگر', icon: 'paperplane', tint: '246,238,255', blurb: 'نسخهٔ پیام رسان های دیگر هنوز ساخته نشده است.' },
];

export const isLive = service => service.status === 'live';

export function homeLayout(services = SERVICES) {
  const live = services.filter(isLive), soon = services.filter(s => !isLive(s));
  const secondary = soon.slice(0, 3), more = soon.slice(3);
  return { primary: live.slice(0, 3), secondary, more, moreCount: more.length };
}
