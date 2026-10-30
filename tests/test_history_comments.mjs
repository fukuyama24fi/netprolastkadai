// Node.js 標準のテストランナーだけで動く簡易プロトコルテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachHistoryComments, initializeHistoryComments } from '../server/historyComments.js';

test('コメントテーブル初期化・一覧取得・投稿・ブロードキャスト', async () => {
  const handlers = new Map();
  const events = [];
  const queries = [];
  const socket = { on: (name, fn) => handlers.set(name, fn) };
  const io = { emit: (name, value) => events.push([name, value]) };
  const pool = {
    async query(query, params) {
      queries.push([query, params]);
      if (query.includes('CREATE TABLE')) return { rows: [] };
      if (query.includes('INSERT INTO history_comments')) return {
        rows: [{ id: '1', user_id: 'user-1', user_name: 'テスト', message: params[2], created_at: new Date() }]
      };
      if (query.includes('SELECT * FROM')) return { rows: [] };
      throw new Error('unexpected query: ' + query);
    }
  };
  await initializeHistoryComments(pool);
  attachHistoryComments(socket, io, pool, () => 'テスト', 'user-1');
  let list;
  await handlers.get('historyComments:list')({}, (ack) => { list = ack; });
  assert.deepEqual(list, { ok: true, comments: [] });
  let sent;
  await handlers.get('historyComments:add')({ message: 'こんにちは' }, (ack) => { sent = ack; });
  assert.deepEqual(sent, { ok: true });
  assert.equal(events[0][0], 'historyComments:new');
  assert.equal(events[0][1].message, 'こんにちは');
  assert.equal(events[0][1].userName, 'テスト');
  assert.ok(queries.some(([query]) => query.includes('INSERT INTO history_comments')));
});

test('空コメントは保存しない', async () => {
  const handlers = new Map();
  const socket = { on: (name, fn) => handlers.set(name, fn) };
  const pool = { query: () => { throw new Error('query should not run'); } };
  attachHistoryComments(socket, { emit() {} }, pool, () => 'A', 'u');
  let result;
  await handlers.get('historyComments:add')({ message: ' ' }, (ack) => { result = ack; });
  assert.equal(result.ok, false);
});
