const { google } = require('googleapis');

// y.matsuzaka@anclas.jp のカレンダーをデフォルトターゲットにする
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'y.matsuzaka@anclas.jp';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません');

  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    // 読み取りのみの場合は readonly でも可
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

// 'sv-SE' ロケールは YYYY-MM-DD 形式を返すので JST 日付文字列に便利
function toJSTDate(date) {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * 予定一覧を取得する
 *
 * @param {{
 *   start_date?: string,  // YYYY-MM-DD（省略時: 今日）
 *   end_date?:   string,  // YYYY-MM-DD（省略時: start_date と同日）
 * }} input
 *
 * 呼び出し例:
 *   今日の予定 → { start_date: '2025-05-14', end_date: '2025-05-14' }
 *   明日の予定 → { start_date: '2025-05-15', end_date: '2025-05-15' }
 *   今週の予定 → { start_date: '2025-05-14', end_date: '2025-05-18' }
 */
async function getCalendarEvents({ start_date, end_date } = {}) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const today    = toJSTDate(new Date());
  const startStr = start_date ?? today;
  const endStr   = end_date   ?? startStr;

  // 当日 00:00:00 JST 〜 終了日 23:59:59 JST
  const timeMin = new Date(`${startStr}T00:00:00+09:00`).toISOString();
  const timeMax = new Date(`${endStr}T23:59:59+09:00`).toISOString();

  const res = await calendar.events.list({
    calendarId:   CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   30,
  });

  const events = (res.data.items ?? []).map(e => {
    const startRaw = e.start.dateTime ?? e.start.date;
    const endRaw   = e.end.dateTime   ?? e.end.date;

    // 表示用の日本語フォーマット
    const fmt = (iso) => {
      const d = new Date(iso);
      if (iso.length === 10) {
        // 終日イベント（YYYY-MM-DD 形式）
        return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' });
      }
      return d.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric', day: 'numeric', weekday: 'short',
        hour: '2-digit', minute: '2-digit',
      });
    };

    return {
      title:       e.summary     ?? '（無題）',
      start:       startRaw,
      end:         endRaw,
      start_label: fmt(startRaw),
      end_label:   fmt(endRaw),
      all_day:     !e.start.dateTime,
      location:    e.location    ?? '',
      description: e.description ?? '',
    };
  });

  return {
    events,
    count:      events.length,
    start_date: startStr,
    end_date:   endStr,
    calendar:   CALENDAR_ID,
  };
}

/**
 * カレンダーに予定を追加する
 * @param {{ title: string, start: string, end: string, description?: string }} input
 */
async function addCalendarEvent({ title, start, end, description = '' }) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.insert({
    calendarId:  CALENDAR_ID,
    requestBody: {
      summary:     title,
      description,
      start: { dateTime: start, timeZone: 'Asia/Tokyo' },
      end:   { dateTime: end,   timeZone: 'Asia/Tokyo' },
    },
  });

  return {
    success: true,
    message: `予定「${title}」をGoogleカレンダーに追加しました。`,
  };
}

module.exports = { getCalendarEvents, addCalendarEvent };
