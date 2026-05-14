require('dotenv').config();

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');

// ── 設定 ──────────────────────────────────────────
const lineConfig = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const lineClient  = new Client(lineConfig);
const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app         = express();

const SYSTEM_PROMPT = `あなたは福岡J・アンクラスの優秀な秘書AIです。
選手管理・クラブ運営・スポンサー営業・試合運営・アカデミー・経理・契約に関する質問に的確に答えてください。
回答は簡潔かつ実用的にまとめ、必要であれば箇条書きや番号付きリストを使ってください。
不明な点は「確認が必要です」と正直に伝えてください。`;

// ユーザーごとの会話履歴（最大10往復）
const histories = new Map();
const MAX_HISTORY = 10;

// ── Webhook エンドポイント ──────────────────────────
app.post('/webhook', middleware(lineConfig), (req, res) => {
  // LINE には即座に 200 を返す（タイムアウト防止）
  res.sendStatus(200);

  Promise.all(req.body.events.map(handleEvent)).catch(err =>
    console.error('[handleEvent error]', err)
  );
});

// ── ヘルスチェック（Railway の確認用）──────────────
app.get('/', (_, res) => res.send('アンクラス秘書 Bot is running.'));

// ── イベントハンドラ ───────────────────────────────
async function handleEvent(event) {
  // テキストメッセージ以外は無視
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId  = event.source.userId;
  const userMsg = event.message.text.trim();

  // 会話履歴を取得・更新
  if (!histories.has(userId)) histories.set(userId, []);
  const history = histories.get(userId);

  history.push({ role: 'user', content: userMsg });

  // 最大件数を超えたら古い方から2件（1往復）削除
  while (history.length > MAX_HISTORY * 2) history.splice(0, 2);

  let replyText;
  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   history,
    });

    replyText = response.content[0].text;
    history.push({ role: 'assistant', content: replyText });

  } catch (err) {
    console.error('[Claude API error]', err);
    replyText = '申し訳ありません、現在応答できない状態です。しばらくしてから再度お試しください。';
    // エラー時は履歴に残さない（最後のユーザー発言も取り消し）
    history.pop();
  }

  try {
    await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: replyText,
    });
  } catch (err) {
    console.error('[LINE reply error]', err);
  }
}

// ── サーバー起動 ───────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ アンクラス秘書 Bot 起動 — port ${PORT}`);
  if (!process.env.LINE_CHANNEL_SECRET)      console.warn('⚠️  LINE_CHANNEL_SECRET が未設定です');
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) console.warn('⚠️  LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  if (!process.env.ANTHROPIC_API_KEY)         console.warn('⚠️  ANTHROPIC_API_KEY が未設定です');
});
