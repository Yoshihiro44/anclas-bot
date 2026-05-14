require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express   = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { addTask, listTasks }              = require('./notion');
const { getCalendarEvents, addCalendarEvent } = require('./calendar');

// ── 設定 ──────────────────────────────────────────────────────────
const lineConfig = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const lineClient = new Client(lineConfig);
const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app        = express();

// ── システムプロンプト ─────────────────────────────────────────────
const BASE_PROMPT = `あなたは福岡Jアンクラス（女子サッカークラブ）のフロント統括責任者・Yoshihiro Matsuzakaの専属AI秘書です。

【Yoshiの主な業務】
- クラブ全体のフロント運営統括
- 試合運営の企画・実行管理
- スポンサー営業・提案・契約管理
- 対外交渉・提携先とのやり取り
- クラブ経営改善
- アカデミーサポート
- ホームタウン事業
- 経理・各種支払い

【あなたの役割】
1. 試合運営：当日オペレーション・スタッフ配置・タイムライン作成
2. スポンサー営業：提案書・営業メール・トークスクリプト即作成
3. スポンサー管理：契約内容・露出管理・お礼メール文案
4. 対外交渉：メール・提案文の下書き作成
5. クラブ経営の壁打ち・アイデア出し

【ツール使用の判断基準】
- 「タスク追加して」「メモして」「登録して」→ notion_add_task を使う
- 「タスク確認」「今日のタスク」「何があった」→ notion_list_tasks を使う
- 「今日の予定」「明日の予定」「今週の予定」「〇日の予定」「スケジュール確認」→ calendar_get_events を使う（start_date/end_date を適切に設定する）
- 「予定追加」「カレンダーに入れて」「〇時から〇〇を登録」→ calendar_add_event を使う
- その他（メール文面・企画書・相談）→ ツールを使わずそのまま回答

【回答ルール】
- 結論ファースト
- 文章・テンプレはすぐ出す
- 具体的・実用的
- 簡潔に、使えるものをすぐ出す`;

function getSystemPrompt() {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return `[現在日時: ${now}]\n\n${BASE_PROMPT}`;
}

// ── Tool 定義（認証情報が設定されていれば有効化）─────────────────
function getTools() {
  const tools = [];

  if (process.env.NOTION_API_KEY) {
    tools.push(
      {
        name: 'notion_add_task',
        description: 'Notionのタスク管理DBにタスクを追加する。タスク登録・メモ・TODO追加の依頼に使う。',
        input_schema: {
          type: 'object',
          properties: {
            title:    { type: 'string', description: 'タスクのタイトル（具体的に記述）' },
            category: {
              type: 'string',
              enum: ['ユニフォーム', 'イベント・MT', 'グッズ・販売', '選手サポート', '営業・提携', 'その他'],
              description: 'タスクカテゴリ。内容から適切なものを選ぶ',
            },
            due_date: { type: 'string', description: '期限日 YYYY-MM-DD。不明・未指定なら省略' },
          },
          required: ['title', 'category'],
        },
      },
      {
        name: 'notion_list_tasks',
        description: 'Notionから未完了のアンクラスタスク一覧を取得する。タスク確認・進捗チェックに使う。',
        input_schema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '取得件数（デフォルト10、最大20）' },
          },
        },
      }
    );
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    tools.push(
      {
        name: 'calendar_get_events',
        description: 'y.matsuzaka@anclas.jpのGoogleカレンダーから予定を取得する。「今日の予定」「明日の予定」「今週の予定」など日付範囲を指定して取得する。',
        input_schema: {
          type: 'object',
          properties: {
            start_date: {
              type: 'string',
              description: '取得開始日 YYYY-MM-DD形式。「今日」なら今日の日付、「明日」なら明日の日付を入れる。省略時は今日。',
            },
            end_date: {
              type: 'string',
              description: '取得終了日 YYYY-MM-DD形式。「今週」なら今週末（日曜）の日付。省略時はstart_dateと同日（1日分）。',
            },
          },
        },
      },
      {
        name: 'calendar_add_event',
        description: 'Google Calendarに予定を追加する。日程登録・スケジュール入力に使う。',
        input_schema: {
          type: 'object',
          properties: {
            title:       { type: 'string',  description: '予定のタイトル' },
            start:       { type: 'string',  description: '開始日時 ISO 8601形式（例: 2025-05-20T14:00:00+09:00）' },
            end:         { type: 'string',  description: '終了日時 ISO 8601形式' },
            description: { type: 'string',  description: '詳細・メモ（任意）' },
          },
          required: ['title', 'start', 'end'],
        },
      }
    );
  }

  return tools;
}

// ── Tool 実行 ─────────────────────────────────────────────────────
async function executeTool(name, input) {
  console.log(`[Tool] ${name}`, JSON.stringify(input));
  try {
    switch (name) {
      case 'notion_add_task':     return await addTask(input);
      case 'notion_list_tasks':   return await listTasks(input);
      case 'calendar_get_events': return await getCalendarEvents(input);
      case 'calendar_add_event':  return await addCalendarEvent(input);
      default: return { error: `未知のツール: ${name}` };
    }
  } catch (err) {
    console.error(`[Tool error: ${name}]`, err.message);
    return { error: err.message };
  }
}

// ── Claude アジェンティックループ ────────────────────────────────
async function askClaude(messages, tools) {
  const MAX_LOOPS = 6;
  const localMsgs = [...messages];

  for (let i = 0; i < MAX_LOOPS; i++) {
    const params = {
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     getSystemPrompt(),
      messages:   localMsgs,
    };
    if (tools.length > 0) params.tools = tools;

    const res = await anthropic.messages.create(params);
    localMsgs.push({ role: 'assistant', content: res.content });

    // ツール呼び出しがなければ終了
    if (res.stop_reason !== 'tool_use') {
      const text = res.content.find(b => b.type === 'text');
      return text?.text ?? '処理が完了しました。';
    }

    // ツール実行 → 結果をメッセージに追加
    const results = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      const result = await executeTool(block.name, block.input);
      results.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     JSON.stringify(result, null, 2),
      });
    }
    localMsgs.push({ role: 'user', content: results });
  }

  return 'リクエストの処理に時間がかかりました。もう一度お試しください。';
}

// ── 会話履歴管理（テキスト往復のみ保存）─────────────────────────
const histories    = new Map();
const MAX_HISTORY  = 8; // 最大8往復

// ── Webhook ───────────────────────────────────────────────────────
app.post('/webhook', middleware(lineConfig), (req, res) => {
  res.sendStatus(200); // LINE には即時 200
  Promise.all(req.body.events.map(handleEvent)).catch(e =>
    console.error('[webhook error]', e)
  );
});

// ヘルスチェック
app.get('/', (_, res) => {
  const tools = getTools().map(t => t.name);
  res.json({
    status:  'running',
    tools:   tools.length ? tools : ['none (AI chat only)'],
    time:    new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
  });
});

// ── イベントハンドラ ──────────────────────────────────────────────
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId  = event.source.userId;
  const userMsg = event.message.text.trim();

  if (!histories.has(userId)) histories.set(userId, []);
  const history = histories.get(userId);

  const messages = [...history, { role: 'user', content: userMsg }];
  const tools    = getTools();

  let reply;
  try {
    reply = await askClaude(messages, tools);

    // 履歴を更新（テキストのみ）
    history.push(
      { role: 'user',      content: userMsg },
      { role: 'assistant', content: reply   },
    );
    while (history.length > MAX_HISTORY * 2) history.splice(0, 2);

  } catch (err) {
    console.error('[askClaude error]', err);
    reply = '申し訳ありません、エラーが発生しました。もう一度お試しください。';
  }

  // LINE の文字数上限（5000字）を超える場合は分割して送信
  const chunks = chunkText(reply, 4500);
  try {
    await lineClient.replyMessage(event.replyToken, { type: 'text', text: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await lineClient.pushMessage(userId, { type: 'text', text: chunks[i] });
    }
  } catch (err) {
    console.error('[LINE reply error]', err);
  }
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

// ── 起動 ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ アンクラス秘書 Bot — port ${PORT}`);
  const required = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'ANTHROPIC_API_KEY'];
  required.forEach(k => { if (!process.env[k]) console.warn(`⚠️  ${k} 未設定`); });
  const tools = getTools();
  console.log('🔧 有効なツール:', tools.length ? tools.map(t => t.name).join(', ') : 'なし（AI応答のみ）');
});
