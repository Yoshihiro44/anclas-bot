const { google } = require('googleapis');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません');

  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

/**
 * 今後の予定一覧を取得する
 * @param {{ days?: number }} input
 */
async function getCalendarEvents({ days = 7 } = {}) {
  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);

  const res = await calendar.events.list({
    calendarId:   CALENDAR_ID,
    timeMin:      now.toISOString(),
    timeMax:      end.toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   20,
  });

  const events = (res.data.items ?? []).map(e => ({
    title:       e.summary     ?? '（無題）',
    start:       e.start.dateTime ?? e.start.date,
    end:         e.end.dateTime   ?? e.end.date,
    description: e.description   ?? '',
    location:    e.location       ?? '',
  }));

  return { events, count: events.length, days };
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
