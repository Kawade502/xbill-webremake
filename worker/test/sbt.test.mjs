// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { normalizeSbtRequest, SBT_REQ_PREFIX, SBT_DAY_PREFIX, SBT_DAILY_LIMIT } from '../src/sbt.js';
import { RANKING_KEY } from '../src/ranking.js';

const ORIGIN = 'https://kawade502.github.io';
const ADDR = '0x52908400098527886E0F7030069857D2E4169EE7';   // EIP-55 の例のアドレス

function makeEnv(enabled = 'true') {
  const store = new Map();
  return {
    store,
    ALLOWED_ORIGINS: ORIGIN,
    SBT_REQUESTS_ENABLED: enabled,
    RANKING: {
      async get(key, type) {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(key, value, opts) { store.set(key, value); if (opts) store.set(key + '#opts', JSON.stringify(opts)); }
    }
  };
}

const post = (env, body, origin = ORIGIN, raw = false) => worker.fetch(new Request('https://api.example/sbt-request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: raw ? body : JSON.stringify(body)
}), env);
const ok = (extra = {}) => ({ address: ADDR, name: 'Alice', score: 12345, consent: true, ...extra });
const reqKeys = (env) => [...env.store.keys()].filter((k) => k.startsWith(SBT_REQ_PREFIX) && !k.endsWith('#opts'));

test('受付: 201 を返し、小文字のアドレスで保存する', async () => {
  const env = makeEnv();
  const res = await post(env, ok());
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const saved = JSON.parse(env.store.get(SBT_REQ_PREFIX + ADDR.toLowerCase()));
  assert.equal(saved.address, ADDR.toLowerCase());
  assert.equal(saved.name, 'Alice');
  assert.equal(saved.score, 12345);
  assert.equal(saved.status, 'pending');
  assert.match(saved.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('受付停止中（SBT_REQUESTS_ENABLED が true 以外）は 503 で、保存しない', async () => {
  for (const v of ['false', '', undefined, 'yes']) {
    const env = makeEnv();
    env.SBT_REQUESTS_ENABLED = v;   // makeEnv(undefined) だと既定値になるので、後から入れる
    assert.equal((await post(env, ok())).status, 503, `enabled=${v}`);
    assert.equal(env.store.size, 0);
  }
});

test('アドレスの形式が不正なら 400', async () => {
  const env = makeEnv();
  for (const a of ['', '0x123', ADDR.slice(2), ADDR + '0', '0xZZ08400098527886E0F7030069857D2E4169EE7', '0x' + '0'.repeat(40), null, 123, ' ']) {
    const res = await post(env, ok({ address: a }));
    assert.equal(res.status, 400, `address=${a}`);
    assert.match((await res.json()).error, /アドレス/);
  }
  assert.equal(reqKeys(env).length, 0);
});

test('同意が true でなければ 400', async () => {
  const env = makeEnv();
  for (const c of [false, 'true', 1, undefined, null]) {
    const res = await post(env, ok({ consent: c }));
    assert.equal(res.status, 400, `consent=${c}`);
    assert.match((await res.json()).error, /同意/);
  }
  assert.equal(reqKeys(env).length, 0);
});

test('スコアが不正なら 400', async () => {
  const env = makeEnv();
  for (const s of [-1, 10000001, 'abc', null, undefined]) {
    assert.equal((await post(env, ok({ score: s }))).status, 400, `score=${s}`);
  }
});

test('同じアドレス（大文字小文字違いも含む）の二度目は 409', async () => {
  const env = makeEnv();
  assert.equal((await post(env, ok())).status, 201);
  const res = await post(env, ok({ address: ADDR.toLowerCase(), name: 'Bob' }));
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(env.store.get(SBT_REQ_PREFIX + ADDR.toLowerCase())).name, 'Alice');   // 上書きしない
});

test('1日の上限を超えると 429。日付ごとの件数は2日で消える設定', async () => {
  const env = makeEnv();
  for (let i = 0; i < SBT_DAILY_LIMIT; i++) {
    const a = '0x' + (i + 1).toString(16).padStart(40, '0');
    assert.equal((await post(env, ok({ address: a }))).status, 201, `#${i}`);
  }
  assert.equal((await post(env, ok())).status, 429);
  const dayKey = [...env.store.keys()].find((k) => k.startsWith(SBT_DAY_PREFIX) && !k.endsWith('#opts'));
  assert.equal(env.store.get(dayKey), String(SBT_DAILY_LIMIT));
  assert.equal(JSON.parse(env.store.get(dayKey + '#opts')).expirationTtl, 172800);
});

test('名前は整形して保存し、日時は端末ではなくサーバーの時刻', () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 0);
  const e = normalizeSbtRequest({ address: ADDR, name: '  a‮b  ', score: '10', consent: true, requestedAt: '1999-01-01' }, now);
  assert.equal(e.name, 'ab');
  assert.equal(e.score, 10);
  assert.equal(e.requestedAt, '2026-10-04T12:00:00.000Z');
});

test('許可外の Origin は 403、本文が大きすぎる・JSON でないなら 400', async () => {
  const env = makeEnv();
  assert.equal((await post(env, ok(), 'https://evil.example')).status, 403);
  assert.equal((await post(env, 'nope', ORIGIN, true)).status, 400);
  assert.equal((await post(env, ok({ name: 'x'.repeat(2000) }))).status, 400);
  assert.equal(reqKeys(env).length, 0);
});

test('申請の一覧を読む口は無い（GET は 404）。ランキングには影響しない', async () => {
  const env = makeEnv();
  await post(env, ok());
  for (const path of ['/sbt-request', '/sbt-requests', '/sbt']) {
    assert.equal((await worker.fetch(new Request('https://api.example' + path, { headers: { Origin: ORIGIN } }), env)).status, 404, path);
  }
  assert.equal(env.store.has(RANKING_KEY), false);
});
