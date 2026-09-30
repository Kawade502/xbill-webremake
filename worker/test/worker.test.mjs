// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHandle, cleanName, normalizeEntry, compareEntries, RANKING_KEY } from '../src/ranking.js';
import worker from '../src/index.js';

const ORIGIN = 'https://kawade502.github.io';
const ch = (code) => String.fromCharCode(code);

function makeEnv(initial) {
  const store = new Map();
  if (initial !== undefined) store.set(RANKING_KEY, initial);
  return {
    store,
    ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:8000`,
    RANKING: {
      async get(key, type) {
        const v = store.get(key);
        if (v === undefined) return null;
        if (type === 'json') return JSON.parse(v);   // 壊れた JSON は例外になる（本物の KV と同じ）
        return v;
      },
      async put(key, value) { store.set(key, value); }
    }
  };
}

const post = (env, body, origin = ORIGIN, raw = false) => worker.fetch(new Request('https://api.example/score', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: raw ? body : JSON.stringify(body)
}), env);
const get = (env, origin = ORIGIN) => worker.fetch(new Request('https://api.example/ranking', { headers: origin ? { Origin: origin } : {} }), env);

test('GET /ranking: 空は []', async () => {
  const res = await get(makeEnv());
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).ranking, []);
});

test('GET /ranking: 壊れた JSON・配列以外・不正な要素は無視', async () => {
  assert.deepEqual((await (await get(makeEnv('{oops'))).json()).ranking, []);
  assert.deepEqual((await (await get(makeEnv('{"a":1}'))).json()).ranking, []);
  const bad = JSON.stringify([{ name: 'ok', score: 10, level: 1, at: 1 }, { name: 5, score: 1 }, null, 'x']);
  const r = (await (await get(makeEnv(bad))).json()).ranking;
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'ok');
});

test('POST /score: 登録して順位を返し、KV に保存する', async () => {
  const env = makeEnv();
  const res = await post(env, { name: 'Alice', score: 1200, level: 3, cleared: false });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rank, 1);
  assert.equal(body.ranking[0].name, 'Alice');
  assert.equal(JSON.parse(env.store.get(RANKING_KEY)).length, 1);
});

test('降順ソート。同点は先着が上', async () => {
  const env = makeEnv();
  await post(env, { name: 'A', score: 500, level: 1 });
  await post(env, { name: 'B', score: 900, level: 1 });
  const body = await (await post(env, { name: 'C', score: 500, level: 1 })).json();
  assert.deepEqual(body.ranking.map((e) => e.name), ['B', 'A', 'C']);
  assert.equal(body.rank, 3);
});

test('保存は上位20件、返却は上位10件、圏外は rank 0', async () => {
  const env = makeEnv();
  for (let i = 1; i <= 25; i++) await post(env, { name: 'P' + i, score: i * 100, level: 1 });
  assert.equal(JSON.parse(env.store.get(RANKING_KEY)).length, 20);
  const body = await (await post(env, { name: 'low', score: 1, level: 1 })).json();
  assert.equal(body.ranking.length, 10);
  assert.equal(body.rank, 0);
  assert.equal((await (await get(env)).json()).ranking[0].score, 2500);
});

test('名前の整形: trim・制御/ゼロ幅/双方向制御文字の除去・12文字・空はNO NAME', () => {
  assert.equal(cleanName('  bob  '), 'bob');
  assert.equal(cleanName('a' + ch(0) + 'b' + ch(0x202e) + 'c' + ch(0x200b) + 'd\nE'), 'abcdE');
  assert.equal(cleanName('1234567890123456'), '123456789012');
  assert.equal(cleanName('😀'.repeat(14)), '😀'.repeat(12));
  assert.equal(cleanName('   '), 'NO NAME');
  assert.equal(cleanName(null), 'NO NAME');
  assert.equal(cleanName(undefined), 'NO NAME');
  assert.ok(cleanName('<img src=x onerror=alert(1)>').length <= 24);   // 保存はするが、画面では textContent で表示する
});

test('不正な score / level は 400 で、保存しない', async () => {
  const env = makeEnv();
  for (const s of [-1, 10000001, NaN, Infinity, 'abc', undefined, null]) {
    const res = await post(env, { name: 'x', score: s, level: 1 });
    assert.equal(res.status, 400, `score=${s}`);
    assert.match((await res.json()).error, /スコア/);
  }
  for (const l of [0, 100, NaN, -3, undefined]) {
    const res = await post(env, { name: 'x', score: 10, level: l });
    assert.equal(res.status, 400, `level=${l}`);
    assert.match((await res.json()).error, /レベル/);
  }
  assert.equal(env.store.has(RANKING_KEY), false);
});

test('数値文字列・小数は整数に丸める', () => {
  const e = normalizeEntry({ name: 'x', score: '1234.9', level: '2.7' });
  assert.equal(e.score, 1234);
  assert.equal(e.level, 2);
});

test('cleared: true のときだけ全クリア扱い', () => {
  assert.equal(normalizeEntry({ score: 1, level: 10, cleared: true }).cleared, true);
  for (const v of [undefined, false, 'true', 1, null]) {
    assert.equal(normalizeEntry({ score: 1, level: 10, cleared: v }).cleared, false);
  }
});

test('compareEntries: スコア降順、同点は at の早い順', () => {
  assert.ok(compareEntries({ score: 2, at: 5 }, { score: 1, at: 1 }) < 0);
  assert.ok(compareEntries({ score: 1, at: 1 }, { score: 1, at: 5 }) < 0);
});

test('本文が JSON でない・大きすぎる場合は 400', async () => {
  const env = makeEnv();
  assert.equal((await post(env, 'not json', ORIGIN, true)).status, 400);
  assert.equal((await post(env, JSON.stringify({ name: 'x'.repeat(2000), score: 1, level: 1 }), ORIGIN, true)).status, 400);
  assert.equal(env.store.has(RANKING_KEY), false);
});

test('CORS: 許可した Origin には ACAO を付ける。許可外には付けない', async () => {
  const env = makeEnv();
  assert.equal((await get(env, ORIGIN)).headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await get(env, 'https://evil.example')).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await get(env, null)).headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await get(env, ORIGIN)).headers.get('Vary'), 'Origin');
});

test('OPTIONS（プリフライト）: 許可した Origin は 204 と許可ヘッダー', async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request('https://api.example/score', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
});

test('許可外の Origin からの POST は 403 で、保存しない。Origin の無い呼び出しは通る', async () => {
  const env = makeEnv();
  assert.equal((await post(env, { name: 'x', score: 1, level: 1 }, 'https://evil.example')).status, 403);
  assert.equal(env.store.has(RANKING_KEY), false);
  assert.equal((await post(env, { name: 'x', score: 1, level: 1 }, null)).status, 200);
});

test('存在しないパスは 404、KV が例外を投げても 500 で落ちない', async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request('https://api.example/nope'), env);
  assert.equal(res.status, 404);
  env.RANKING.put = async () => { throw new Error('quota exceeded'); };
  const res2 = await post(env, { name: 'x', score: 1, level: 1 });
  assert.equal(res2.status, 500);
});
