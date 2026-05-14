const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// CLAUDE.md に記載の DB ID をデフォルトとして使用
const DB_ID = process.env.NOTION_DB_ID || '62a5c6769522437ebd9926a65eacb7b3';

// Notionプロパティ名（DBの実際の名前と異なる場合は env var で上書き可能）
const P = {
  title:    process.env.NOTION_PROP_TITLE    || '名前',
  status:   process.env.NOTION_PROP_STATUS   || 'ステータス',
  project:  process.env.NOTION_PROP_PROJECT  || 'プロジェクト',
  category: process.env.NOTION_PROP_CATEGORY || 'カテゴリ',
  dueDate:  process.env.NOTION_PROP_DUE_DATE || '期限',
};

/**
 * Notionにタスクを追加する
 * @param {{ title: string, category: string, due_date?: string }} input
 */
async function addTask({ title, category = 'その他', due_date = null }) {
  const properties = {
    [P.title]:   { title: [{ text: { content: title } }] },
    [P.project]: { select: { name: 'アンクラス' } },
    [P.category]: { select: { name: category } },
  };

  if (due_date) {
    properties[P.dueDate] = { date: { start: due_date } };
  }

  await notion.pages.create({
    parent: { database_id: DB_ID },
    properties,
  });

  return {
    success: true,
    message: `タスク「${title}」をNotionに追加しました。`,
  };
}

/**
 * 未完了タスク一覧を取得する
 * @param {{ limit?: number }} input
 */
async function listTasks({ limit = 10 } = {}) {
  const response = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      and: [
        { property: P.project, select: { equals: 'アンクラス' } },
        { property: P.status,  status: { does_not_equal: '完了' } },
      ],
    },
    sorts: [{ property: P.dueDate, direction: 'ascending' }],
    page_size: Math.min(limit, 20),
  });

  const tasks = response.results.map(page => {
    const props = page.properties;
    return {
      title:    props[P.title]?.title?.[0]?.text?.content  ?? '（無題）',
      status:   props[P.status]?.status?.name              ?? '',
      category: props[P.category]?.select?.name            ?? '',
      dueDate:  props[P.dueDate]?.date?.start              ?? null,
    };
  });

  return { tasks, count: tasks.length };
}

module.exports = { addTask, listTasks };
