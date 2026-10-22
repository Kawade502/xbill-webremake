// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
// 短い時間の回数制限（Rate Limiting binding）・書く順番・運営者へのメールの上限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { NOTIFY_DAY_PREFIX, NOTIFY_DAILY_LIMIT, SBT_REQ_PREFIX } from '../src/sbt.js';
import { BEER_SBT_REQ_PREFIX } from '../src/beer-sbt.js';

const ORIGIN = 'https://kawade502.github.io';

function makeEnv(extra = {}) {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    ALLOWED_ORIGINS: ORIGIN,
    SBT_REQUESTS_ENABLED: 'true',
    BEER_SBT_REQUESTS_ENABLED: 'true',
    RANKING: {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async put(key, value) { puts.push(key); store.set(key, value); }
    },
    ...extra
  };
}

// Rate Limiting binding のまね。limit 回を超えたら success: false
function limiter(limit) {
  const seen = new Map();
  return {
    keys: seen,
    async limit({ key }) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    }
  };
}

const postTo = (path, env, body, ip = '203.0.113.7') => worker.fetch(new Request('https://api.example' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
  body: JSON.stringify(body)
}), env);
const addr = (i) => '0x' + (i + 1).toString(16).padStart(40, '0');
const score = { name: 'A', score: 100, level: 1, cleared: false };
const xbill = (i) => ({ address: addr(i), name: 'A', score: 1, consent: true });
const beer = (i) => ({ address: addr(i), badge: 'kanpai', cups: 2, consent: true });

test('ランキングの送信：同じ送り元は SCORE_LIMITER を超えたら 429、別の送り元は通る', async () => {
  const env = makeEnv({ SCORE_LIMITER: limiter(2) });
  assert.equal((await postTo('/score', env, score)).status, 200);
  assert.equal((await postTo('/score', env, score)).status, 200);
  const res = await postTo('/score', env, score);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).status, 'limit');
  assert.equal((await postTo('/score', env, score, '198.51.100.1')).status, 200);
  // IPv6 は /56 で数える
  const env6 = makeEnv({ SCORE_LIMITER: limiter(1) });
  assert.equal((await postTo('/score', env6, score, '2001:db8:1:2::1')).status, 200);
  assert.equal((await postTo('/score', env6, score, '2001:db8:1:3::9')).status, 429);
});

test('SBT の申請：送り元ごとの制限（XBill とビールジョッキで共通に数える）', async () => {
  const env = makeEnv({ SBT_IP_LIMITER: limiter(2), SBT_ALL_LIMITER: limiter(100) });
  assert.equal((await postTo('/sbt-request', env, xbill(1))).status, 201);
  assert.equal((await postTo('/beer-sbt-request', env, beer(2))).status, 201);
  const res = await postTo('/beer-sbt-request', env, beer(3));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).status, 'limit');
  assert.equal((await postTo('/sbt-request', env, xbill(4))).status, 429);
  assert.equal((await postTo('/beer-sbt-request', env, beer(5), '198.51.100.1')).status, 201);
  // 止めた申請は保存しない
  assert.equal(env.store.has(BEER_SBT_REQ_PREFIX + 'kanpai:' + addr(3)), false);
});

test('SBT の申請：全体の制限（送り元を変えても止まる）', async () => {
  const env = makeEnv({ SBT_IP_LIMITER: limiter(100), SBT_ALL_LIMITER: limiter(3) });
  for (let i = 0; i < 3; i++) assert.equal((await postTo('/beer-sbt-request', env, beer(i), `198.51.100.${i + 1}`)).status, 201);
  assert.equal((await postTo('/beer-sbt-request', env, beer(9), '198.51.100.50')).status, 429);
  assert.equal((await postTo('/sbt-request', env, xbill(9), '198.51.100.51')).status, 429);
});

test('binding が無い・失敗するときは、制限しない（今までどおり）', async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) assert.equal((await postTo('/score', env, score)).status, 200);
  const broken = { async limit() { throw new Error('down'); } };
  const env2 = makeEnv({ SCORE_LIMITER: broken, SBT_IP_LIMITER: broken, SBT_ALL_LIMITER: broken });
  assert.equal((await postTo('/score', env2, score)).status, 200);
  assert.equal((await postTo('/beer-sbt-request', env2, beer(1))).status, 201);
});

test('書く順番：数を増やしてから、申請を書く', async () => {
  for (const [path, body, prefix] of [['/sbt-request', xbill(1), SBT_REQ_PREFIX], ['/beer-sbt-request', beer(1), BEER_SBT_REQ_PREFIX]]) {
    const env = makeEnv();
    assert.equal((await postTo(path, env, body)).status, 201);
    const req = env.puts.findIndex((k) => k.startsWith(prefix));
    assert.ok(req >= 2, env.puts.join(','));
    assert.ok(env.puts.slice(0, req).some((k) => k.includes(':day:')), env.puts.join(','));
    assert.ok(env.puts.slice(0, req).some((k) => k.includes(':ip:')), env.puts.join(','));
  }
});

test('運営者へのメールは、XBill とビールジョッキを合わせて1日 NOTIFY_DAILY_LIMIT 通まで', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('ok', { status: 302 }); };
  try {
    const env = makeEnv({ NOTIFY_URL: 'https://script.example/exec', NOTIFY_SECRET: 's3cret' });
    const n = NOTIFY_DAILY_LIMIT + 3;
    for (let i = 0; i < n; i++) {
      const [path, body] = i % 2 ? ['/sbt-request', xbill(i)] : ['/beer-sbt-request', beer(i)];
      // 送り元ごとの1日の上限に当たらないよう、送り元を変える
      assert.equal((await postTo(path, env, body, `198.51.100.${i + 1}`)).status, 201);
    }
    assert.equal(calls.length, NOTIFY_DAILY_LIMIT);
    // 申請はすべて保存されている（メールが来なくても、一覧で見られる）
    const saved = [...env.store.keys()].filter((k) => k.startsWith(SBT_REQ_PREFIX) || k.startsWith(BEER_SBT_REQ_PREFIX));
    assert.equal(saved.length, n);
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(env.store.get(NOTIFY_DAY_PREFIX + day), String(NOTIFY_DAILY_LIMIT));
  } finally {
    globalThis.fetch = realFetch;
  }
});
