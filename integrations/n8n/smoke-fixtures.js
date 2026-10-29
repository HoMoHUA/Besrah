// SYNTHETIC TEST INPUTS ONLY. Never production observations or real Telegram messages.
const privateMessage = fields => ({ chat: { id: 900000001, type: 'private' }, from: { is_bot: false }, ...fields });
// expected_station is the canonical name the prediction must show (only for station/location cases).
const stationFor = { station: 'وکیل‌آباد', location: 'وکیل‌آباد', line2_name: 'طبرسی', line2_nickname: 'شهید فکوری', line2_location: 'طبرسی' };
const cases = [
  ['station', 'station', { text: 'وكيل آباد' }],
  ['location', 'location', { location: { latitude: 36.3461444, longitude: 59.4422694 } }],
  ['start', 'help', { text: '/start' }],
  ['unknown', 'unknown', { text: '<نام ناشناخته &>' }],
  ['line2_name', 'station', { text: 'طبرسی' }],
  ['line2_nickname', 'station', { text: 'فکوری' }],
  ['line2_location', 'location', { location: { latitude: 36.32504, longitude: 59.675348 } }],
  ['outside_service', 'outside_service_area', { location: { latitude: 35.6892, longitude: 51.389 } }],
  ['malformed_coords', 'invalid_location', { location: { latitude: 200, longitude: 59 } }],
  ['stations', 'stations', { text: '/stations' }],
];
return cases.map(([test_case, expected_normalized_kind, fields], index) => ({ json: {
  synthetic_test: true, test_case, expected_normalized_kind, expected_station: stationFor[test_case],
  expected_render_kind: ['station', 'location'].includes(expected_normalized_kind) ? 'prediction' : expected_normalized_kind,
  message: { ...privateMessage(fields), chat: { id: 900000001 + index, type: 'private' } },
} }));
