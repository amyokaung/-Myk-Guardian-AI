import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

type NativeResult = { success: boolean; message?: string };
type AgentNative = {
  launchApp(options: { app: string }): Promise<NativeResult>;
  reverseGeocode(options: { latitude: number; longitude: number }): Promise<{ address?: string }>;
  performAction(options: { action: string; text?: string; number?: string; exact?: boolean; hour?: number; minute?: number; label?: string }): Promise<NativeResult>;
};
const Native = registerPlugin<AgentNative>('MykAccessibility');

export async function executeAgentAction(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const allowed = new Set(['get_weather', 'get_location', 'open_app', 'back', 'home', 'media_next', 'media_previous', 'media_play_pause', 'volume_up', 'volume_down', 'open_settings', 'click_text', 'search_youtube', 'open_phone', 'call_phone', 'write_note', 'set_text', 'search_places', 'set_alarm']);
  if (!allowed.has(name)) throw new Error('လုံခြုံရေးအတွက် မပံ့ပိုးထားသော action ကို ပိတ်ထားပါတယ်။');
  if (name === 'get_weather') return getWeather(typeof args.query === 'string' ? args.query.trim() : '');
  if (name === 'get_location') return currentLocationAnswer();
  let result: NativeResult;
  if (name === 'open_app') {
    const app = typeof args.app === 'string' ? args.app.trim() : '';
    if (!app) throw new Error('ဖွင့်မည့် App အမည် မပါပါ။');
    result = await Native.launchApp({ app });
  } else {
    const actionMap: Record<string, string> = {
      back: 'back', home: 'home', media_next: 'mediaNext', media_previous: 'mediaPrevious',
      media_play_pause: 'mediaPlayPause', volume_up: 'volumeUp', volume_down: 'volumeDown',
      open_settings: 'openSettings', click_text: 'clickText', search_youtube: 'searchYouTube',
      open_phone: 'openPhone', call_phone: 'callPhone', write_note: 'writeNote', set_text: 'setText',
      search_places: 'searchPlaces', set_alarm: 'setAlarm'
    };
    const text = name === 'search_youtube' ? (typeof args.query === 'string' ? args.query.trim() : '')
      : name === 'search_places' ? (typeof args.query === 'string' ? args.query.trim() : '')
      : (typeof args.text === 'string' ? args.text.trim() : '');
    const number = typeof args.number === 'string' ? args.number.trim() : '';
    if (['click_text'].includes(name) && !text) throw new Error('နှိပ်မည့် စာသားကို text ဖြင့် ပေးပါ။');
    if (['search_youtube', 'search_places'].includes(name) && !text) throw new Error('ရှာဖွေမည့် သီချင်း/နေရာအမည်ကို ပေးပါ။');
    if ((name === 'write_note' || name === 'set_text') && !text) throw new Error('ရေးမည့် စာသားကို ပေးပါ။');
    const hour = typeof args.hour === 'number' ? args.hour : undefined;
    const minute = typeof args.minute === 'number' ? args.minute : undefined;
    const label = typeof args.label === 'string' ? args.label : undefined;
    result = await Native.performAction({
      action: actionMap[name],
      ...(name === 'click_text' ? { text, exact: args.exact === true }
        : name === 'search_youtube' || name === 'search_places' || name === 'write_note' || name === 'set_text' ? { text }
        : name === 'call_phone' && number ? { number }
        : name === 'set_alarm' ? { hour, minute, label } : {})
    });
  }
  if (!result.success) throw new Error(result.message || 'Android action မအောင်မြင်ပါ။');
  return result.message || 'Android က action ကို လက်ခံပြီးပါပြီ။';
}

const toAsciiDigits = (value: string) => value.replace(/[၀-၉]/g, d => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(d)));
const weekdayMyanmar = ['တနင်္ဂနွေ', 'တနင်္လာ', 'အင်္ဂါ', 'ဗုဒ္ဓဟူး', 'ကြာသပတေး', 'သောကြာ', 'စနေ'];
function calendarAnswer(offsetDays: number, label: string): string {
  // Calculate from the device's local calendar; never ask an LLM to guess weekdays.
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const weekday = weekdayMyanmar[date.getDay()];
  const dateText = date.getFullYear() + ' ခုနှစ်၊ ' + (date.getMonth() + 1) + ' လ၊ ' + date.getDate() + ' ရက်';
  const emoji = offsetDays === 0 ? '☀️' : offsetDays > 0 ? '🌷' : '🍃';
  return emoji + ' ' + label + ' ' + weekday + 'နေ့ပါနော်။ (' + dateText + ')';
}

const weatherDescription = (code: number): string => {
  if (code === 0) return 'ကောင်းကင်ကြည်လင်နေပါတယ် ☀️';
  if ([1, 2, 3].includes(code)) return code === 1 ? 'တိမ်အနည်းငယ်ရှိပါတယ် 🌤️' : code === 2 ? 'တိမ်အသင့်အတင့်ရှိပါတယ် ⛅' : 'တိမ်ထူနေပါတယ် ☁️';
  if ([45, 48].includes(code)) return 'မြူဆိုင်းနေပါတယ် 🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return 'မိုးဖွဲဖွဲကျနိုင်ပါတယ် 🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'မိုးရွာနေပါတယ် သို့မဟုတ် ရွာနိုင်ပါတယ် 🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'နှင်းကျနေပါတယ် ❄️';
  if ([95, 96, 99].includes(code)) return 'မိုးကြိုးမုန်တိုင်း ဖြစ်နိုင်ပါတယ် ⛈️';
  return 'ရာသီဥတုအခြေအနေကို ဖော်ပြလို့မရသေးပါ။';
};

function weatherPlaceName(query: string): string {
  const q = query.trim().toLowerCase();
  const aliases: Array<[RegExp, string]> = [
    [/ရန်ကုန်|yangon|rangoon/, 'Yangon'], [/မန္တလေး|mandalay/, 'Mandalay'],
    [/နေပြည်တော်|naypyidaw|nay pyi taw/, 'Naypyidaw'], [/ပုဂံ|bagan|pagan/, 'Bagan'],
    [/မော်လမြိုင်|mawlamyine|moulmein/, 'Mawlamyine'], [/တောင်ကြီး|taunggyi/, 'Taunggyi'],
    [/ပြင်ဦးလွင်|pyin oo lwin/, 'Pyin Oo Lwin'], [/ပုသိမ်|pathein/, 'Pathein'],
    [/လားရှိုး|lashio/, 'Lashio'], [/စစ်တွေ|sittwe/, 'Sittwe'], [/မြစ်ကြီးနား|myitkyina/, 'Myitkyina']
  ];
  for (const [pattern, name] of aliases) if (pattern.test(q)) return name;
  return query.trim().replace(/(?:မှာ|တွင်|ရဲ့|၏)?\s*(?:ရာသီဥတု|မိုးလေဝသ|အပူချိန်|မိုးရွာမလား|မိုးရွာနိုင်လား|weather|forecast|temperature|rain|today|tomorrow|ဘယ်လိုရှိလဲ|ဘယ်လိုလဲ|ဘယ်လိုရှိမလဲ|သိချင်တယ်|ပြောပြပါ|ပြောပြပေးပါ|ကြည့်ပေး|စစ်ပေး)\s*[။.!?]*$/ig, '').trim();
}

async function getWeather(placeQuery = ''): Promise<string> {
  let latitude: number, longitude: number, placeLabel = '';
  if (placeQuery) {
    const place = weatherPlaceName(placeQuery);
    const geoResponse = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(place) + '&count=1&language=en&format=json');
    if (!geoResponse.ok) throw new Error('နေရာအမည်ကို ရှာမရသေးပါ။ မြို့အမည်ကို ထပ်ပြောပေးပါနော်။');
    const geo = await geoResponse.json();
    const match = geo?.results?.[0];
    if (!match) throw new Error('“' + placeQuery + '” ဆိုတဲ့နေရာကို မတွေ့ပါဘူး။ မြို့အမည်ကို မြန်မာလို ဒါမှမဟုတ် အင်္ဂလိပ်လို ပြောပေးပါနော်။');
    latitude = Number(match.latitude); longitude = Number(match.longitude);
    placeLabel = [match.name, match.admin1, match.country].filter(Boolean).join(', ');
  } else {
    let permission = await Geolocation.checkPermissions();
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') permission = await Geolocation.requestPermissions();
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
      throw new Error('လက်ရှိနေရာရဲ့ ရာသီဥတုကို သိဖို့ Location ခွင့်ပြုချက်လိုပါတယ်နော်။ ဒါမှမဟုတ် မြို့အမည်ကို ပြောပေးလို့ရပါတယ်။');
    }
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
    latitude = position.coords.latitude; longitude = position.coords.longitude;
    placeLabel = 'သင့်လက်ရှိတည်နေရာ';
  }
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto';
  const response = await fetch(url);
  if (!response.ok) throw new Error('ရာသီဥတုအချက်အလက်ကို လောလောဆယ် မရနိုင်သေးပါ။ ခဏနေ ပြန်မေးပေးပါနော်။');
  const data = await response.json();
  const current = data?.current;
  if (!current) throw new Error('ရာသီဥတုအချက်အလက် မပြည့်စုံသေးပါ။');
  const temp = Math.round(Number(current.temperature_2m));
  const feels = Math.round(Number(current.apparent_temperature));
  const humidity = Math.round(Number(current.relative_humidity_2m));
  const wind = Math.round(Number(current.wind_speed_10m));
  const todayIndex = 0;
  const max = Math.round(Number(data.daily.temperature_2m_max[todayIndex]));
  const min = Math.round(Number(data.daily.temperature_2m_min[todayIndex]));
  const rain = data.daily.precipitation_probability_max?.[todayIndex];
  const tomorrowMax = Math.round(Number(data.daily.temperature_2m_max[1]));
  const tomorrowMin = Math.round(Number(data.daily.temperature_2m_min[1]));
  const tomorrowRain = data.daily.precipitation_probability_max?.[1];
  return '🌦️ ' + placeLabel + ' ရဲ့ ရာသီဥတုကို ကြည့်ပေးထားတယ်နော်။\\n' +
    weatherDescription(Number(current.weather_code)) + '\\n' +
    '🌡️ အခုအပူချိန် ' + temp + '°C (ခံစားရနိုင်တဲ့အပူချိန် ' + feels + '°C)\\n' +
    '💧 စိုထိုင်းဆ ' + humidity + '% · 💨 လေတိုက်နှုန်း ' + wind + ' km/h\\n' +
    '📊 ဒီနေ့ ' + min + '°–' + max + '°C · မိုးရွာနိုင်ခြေ ' + (rain == null ? 'မသိရသေး' : rain + '%') + '\\n' +
    '🌷 မနက်ဖြန် ' + tomorrowMin + '°–' + tomorrowMax + '°C · မိုးရွာနိုင်ခြေ ' + (tomorrowRain == null ? 'မသိရသေး' : tomorrowRain + '%') + '\\n' +
    'အပြင်ထွက်မယ်ဆိုရင် ထီးလေးဆောင်သင့်မသင့် ဒီအချက်အလက်နဲ့ ဆုံးဖြတ်နိုင်ပါတယ်နော်။';
}

async function currentLocationAnswer(): Promise<string> {
  let permission = await Geolocation.checkPermissions();
  if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
    permission = await Geolocation.requestPermissions();
  }
  if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
    throw new Error('Location permission မရသေးပါ။ Agent Control ထဲက Location စမ်းရန်ကိုနှိပ်ပြီး ခွင့်ပြုပေးပါ။');
  }
  const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
  let address = '';
  try {
    const result = await Native.reverseGeocode({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    address = result.address?.trim() || '';
  } catch { /* Coordinates remain useful if reverse geocoding is unavailable. */ }
  const coords = position.coords.latitude.toFixed(5) + ', ' + position.coords.longitude.toFixed(5);
  const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(coords);
  return (address ? 'လက်ရှိတည်နေရာ: ' + address : 'လိပ်စာကို အလိုအလျောက် မဖော်ထုတ်နိုင်သေးပါ။ GPS တည်နေရာ') +
    '\nCoordinates: ' + coords + '\nမြေပုံ: ' + mapUrl;
}

function parseAlarmTime(command: string): { hour: number; minute: number } | null {
  const normalized = toAsciiDigits(command.toLowerCase());
  const m = normalized.match(/(မနက်ပိုင်း|မနက်|နံနက်|နေ့လယ်|မွန်းတည့်|ညနေ|ညပိုင်း|ည|morning|afternoon|evening|night|am|pm)?\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?\s*(?:နာရီ\s*(ခွဲ|ကျော်)?|နာရီခွဲ|နာရီ)?\s*(\d{1,2})?\s*(?:မိနစ်)?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = Number(m[2]);
  let minute = m[3] !== undefined ? Number(m[3]) : 0;
  if (m[4] === 'ခွဲ') minute = 30;
  if (m[5] && m[3] === undefined && m[4] !== 'ခွဲ') minute = Number(m[5]);
  if (m[6]) {
    if (m[6].toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (m[6].toLowerCase() === 'am' && hour === 12) hour = 0;
  } else {
    const period = m[1] || '';
    if (/(နေ့လယ်|မွန်းတည့်|ညနေ|ညပိုင်း|ည|afternoon|evening|night)/i.test(period) && hour < 12) hour += 12;
    if (/(မနက်|နံနက်|morning)/i.test(period) && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function placeQueryFromCommand(command: string): string {
  return command.trim()
    .replace(/^(ကျေးဇူးပြု၍|ကျေးဇူးပြုပြီး|please|ငါ့ကို|ကျွန်တော့်ကို|ကျွန်မကို)\s*/i, '')
    .replace(/^(?:go to|take me to|find|search for|navigate to|directions to)\s*/i, '')
    .replace(/^(?:google\s*)?maps?(?:\s*မှာ|\s+ထဲမှာ)?\s*/i, '')
    .replace(/(?:ကို)?\s*(?:ရှာပေးပါ|ရှာပေး|ရှာပါ|ရှာပေးနော်|လမ်းညွှန်ပေးပါ|လမ်းညွှန်ပေး|သွားလမ်းပြပေး|ဘယ်မှာရှိလဲ|ဘယ်မှာရှိ|ဖွင့်ပေးပါ|ဖွင့်ပေး|ရှာ|သွားချင်တယ်|သွားချင်ပါတယ်|သွားမယ်|find it|search for|navigate to|directions to|go there|take me there)\s*[။.!?]*$/i, '')
    .replace(/^(?:ငါသွားချင်တဲ့နေရာ|သွားချင်တဲ့နေရာ|နေရာတစ်ခု|နေရာ)\s*/i, '')
    .trim();
}

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = toAsciiDigits(command.toLowerCase().trim());

  // Live weather is fetched from a forecast service; use GPS unless a city is named.
  if (/(ရာသီဥတု|မိုးလေဝသ|အပူချိန်|မိုးရွာမလား|မိုးရွာနိုင်လား|weather|forecast|temperature|will it rain|is it raining)/i.test(text)) {
    const place = command.trim()
      .replace(/^(ကျေးဇူးပြု၍|ကျေးဇူးပြုပြီး|please|ငါ့ကို|ကျွန်တော့်?ကို|ကျွန်မကို)\\s*/i, '')
      .replace(/(?:ဒီနေ့|ယနေ့|မနက်ဖြန်|tomorrow|today)?\\s*(?:ရာသီဥတု|မိုးလေဝသ|အပူချိန်|မိုးရွာမလား|မိုးရွာနိုင်လား|weather|forecast|temperature|will it rain|is it raining)(?:ကို|က)?\\s*(?:ပြောပြပေးပါ|ပြောပြပါ|ပြောပေး|ကြည့်ပေး|စစ်ပေး|ဘယ်လိုရှိလဲ|ဘယ်လိုလဲ|သိချင်တယ်)?\\s*[။.!?]*$/i, '')
      .replace(/(?:မှာ|ရဲ့|၏)\\s*$/,'').trim();
    const isGeneric = /^(ဒီနေ့|ယနေ့|မနက်ဖြန်|tomorrow|today|ရာသီဥတု|မိုးလေဝသ|အပူချိန်|weather|forecast|မိုးရွာမလား|မိုးရွာနိုင်လား)$/i.test(place);
    return executeAgentAction('get_weather', { query: isGeneric ? '' : place });
  }

  // Answer relative-day questions deterministically from the phone's local calendar.
  // Check longer offsets first so "သန်ဘက်ခါ" is never mistaken for "မနက်ဖြန်".
  const asksDay = /(ဘာနေ့|ဘယ်နေ့|နေ့လဲ|နေ့ဖြစ်မလဲ|what day|day is it|what weekday|which day)/i.test(text);
  if (asksDay) {
    if (/(သန်ဘက်ခါ|သဘက်ခါ|တဘက်ခါ|day after tomorrow)/i.test(text)) return calendarAnswer(2, 'သန်ဘက်ခါက');
    if (/(မနက်ဖြန်|နက်ဖြန်|မနက်ဖန်|tomorrow|tmrw)/i.test(text)) return calendarAnswer(1, 'မနက်ဖြန်က');
    if (/(မနေ့က|မနေ့|yesterday)/i.test(text)) return calendarAnswer(-1, 'မနေ့က');
    if (/(ဒီနေ့|ယနေ့|ဒီနေ့က|today|နေ့ရက်)/i.test(text) || /^(ဘာနေ့လဲ|ဘယ်နေ့လဲ|what day is it\??)$/i.test(text)) return calendarAnswer(0, 'ဒီနေ့က');
  }

  // A direct location request uses the phone's live GPS, not the AI's guessed IP-based location.
  if (/(ငါ|ကျွန်တော်|ကျွန်မ|ကျွန်ုပ်|my|where am i|where am i now).*(ဘယ်ရောက်|ဘယ်မှာ|တည်နေရာ|location|နေရာ)|^(ဘယ်ရောက်နေလဲ|ငါဘယ်ရောက်နေလဲ|လက်ရှိတည်နေရာ|my location|where am i\??|where am i now\??)$/i.test(text) ||
      /(လက်ရှိ|အခု|ယခု).*(တည်နေရာ|ဘယ်ရောက်|နေရာကိုပြ)|current location|show my location|^(?:တည်နေရာ|တည်နေရာကိုပြော|location)$/i.test(text)) {
    return currentLocationAnswer();
  }

  // Alarm commands are executed locally so the model cannot merely answer that it has done it.
  if (/(alarm|နှိုးစက်|နှိုးပါ|နိုးပါ|နှိုးပေး|နိုးပေး|alarm clock)/i.test(text) &&
      /(ထား|ချိန်|set|wake|နှိုး|နိုး|လုပ်ပေး|လုပ်ပါ|လုပ်ပေးပါ)/i.test(text)) {
    const time = parseAlarmTime(text);
    if (!time) throw new Error('Alarm အချိန်ကို မသိရသေးပါ။ ဥပမာ “မနက် ၁၀ နာရီ Alarm ထားပေး” လို့ ပြောပါ။');
    const period = time.hour < 12 ? 'မနက်' : 'ညနေ';
    const displayHour = time.hour % 12 || 12;
    return executeAgentAction('set_alarm', { hour: time.hour, minute: time.minute, label: 'Myk Guardian AI' })
      .then(result => result + '\nသတ်မှတ်ထားသောအချိန်: ' + period + ' ' + displayHour + ':' + String(time.minute).padStart(2, '0'));
  }

  // Exact app name is a first-class command; don't let the AI reinterpret "Notes" as a writing task.
  const noteWrite = command.trim().match(/(?:note|notes|notepad|memo|မှတ်စု)(?:\s*app)?[\s\S]*?(?:ရေးပေး|ရေးပါ|ရေးထည့်|စာရေး)\s*[:：]?\s*["'“]?(.+?)["'”]?\s*$/i);
  if (noteWrite?.[1]) return executeAgentAction('write_note', { text: noteWrite[1].trim() });
  if (/^(?:please\s+)?(?:open\s+)?notes?$/i.test(text) ||
      /(?:notes?|notepad|မှတ်စု)(?:\s*app)?\s*(?:ကို\s*)?(?:ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်|open)$/i.test(text) ||
      /^open\s+(?:the\s+)?notes?\s*(?:app)?$/i.test(text)) {
    return executeAgentAction('open_app', { app: 'Notes' });
  }

  // Search a named destination in a map app. Generic "find a place" requests are left for clarification.
  const wantsPlace = /(နေရာ|ဆေးရုံ|ဆေးခန်း|ဆိုင်|ဘုရား|စားသောက်ဆိုင်|ဟိုတယ်|လမ်းညွှန်|မြေပုံ|maps?|ရှာပေး|ဘယ်မှာရှိ|လမ်းပြ|သွားချင်|သွားမယ်|navigate|directions|go to|take me to|visit|search for|find (?:a place|the place|nearby)|nearest|အနီးဆုံး)/i.test(text);
  if (wantsPlace && !/(ငါဘယ်ရောက်|where am i|လက်ရှိတည်နေရာ|my location)/i.test(text)) {
    const query = placeQueryFromCommand(command);
    const genericOnly = /^(ငါသွားချင်တဲ့နေရာ|သွားချင်တဲ့နေရာ|နေရာကိုရှာပေး|နေရာရှာပေး|နေရာ|မြေပုံ|maps?)$/i.test(query);
    if (query && !genericOnly && query.length > 1) return executeAgentAction('search_places', { query });
  }

  // Route music requests through AI so title/artist follow-ups can be used for YouTube search.
  if (/(သီချင်း|သီချင်းတစ်ပုဒ်|သီချင်းလေး|song|music|track)/i.test(text) && /(ဖွင့်|ဖွင့်|နားထောင်|play|listen|ရှာ)/i.test(text)) return null;
  if (/နောက်တစ်ပုဒ်|သီချင်းကျော်|သီချင်း.*ကျော်|နောက်သီချင်း|next (song|track)|skip (this )?(song|track)|media next/.test(text)) return executeAgentAction('media_next');
  if (/အရင်သီချင်း|ရှေ့သီချင်း|previous (song|track)|last track|နောက်ပြန်သီချင်း/.test(text)) return executeAgentAction('media_previous');
  if (/pause|play|ခဏရပ်|ဆက်ဖွင့်|သီချင်း.*ရပ်|သီချင်း.*ဆက်/.test(text)) return executeAgentAction('media_play_pause');
  if (/အသံတိုး|အသံမြှင့်|volume up|increase volume|louder/.test(text)) return executeAgentAction('volume_up');
  if (/အသံလျှော့|အသံချ|volume down|decrease volume|quieter/.test(text)) return executeAgentAction('volume_down');
  if (/^\s*(home|go home|home button)\s*$|ပင်မစာမျက်နှာ|home ကိုသွား/.test(text)) return executeAgentAction('home');
  if (/\b(back|go back|press back|back button)\b|နောက်ပြန်|နောက်သို့ပြန်|ပြန်သွား/.test(text)) return executeAgentAction('back');
  if (/settings|ဆက်တင်/.test(text) && /ဖွင့်|open|သွား/.test(text)) return executeAgentAction('open_settings');
  const phoneNumber = command.match(/(?:\+?\d[\d\s().-]{5,}\d)/)?.[0]?.replace(/[\s().-]/g, '') || '';
  if (/(ဖုန်းခေါ်|ဖုန်းခေါ်ဆို|ဖုန်းဆက်|call (?:him|her|them|this number|the number|someone)|make a call)/i.test(text)) {
    return phoneNumber ? executeAgentAction('call_phone', { number: phoneNumber }) : executeAgentAction('open_phone');
  }
  if (/(phone|dialer|ဖုန်းခေါ်တဲ့နေရာ)/i.test(text) && /(ဖွင့်|ဖွင့်|open|သွား)/i.test(text)) return executeAgentAction('open_phone');
  const burmeseClick = text.match(/^(.+?)(?:\s*ကို)?\s*(?:နှိပ်ပေး|နှိပ်ပါ|နှိပ်လိုက်|နှိပ်)\s*$/);
  const englishClick = text.match(/^\s*(?:click|tap)\s+["'“]?(.+?)["'”]?\s*$/);
  const clickTarget = (burmeseClick?.[1] || englishClick?.[1] || '').trim().replace(/["'“”]/g, '');
  if (clickTarget) return executeAgentAction('click_text', { text: clickTarget });
  const englishOpen = text.match(/^\s*open\s+(.+?)\s*$/);
  const burmeseOpen = text.match(/^\s*(.+?)\s*(?:ကို\s*)?(?:ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်)\s*$/);
  const target = (englishOpen?.[1] || burmeseOpen?.[1] || '').trim().replace(/\s*ကို\s*$/,'').replace(/^(ကျေးဇူးပြု၍|please)\s*/,'').trim();
  if (!target) return null;
  return executeAgentAction('open_app', { app: target });
}
