// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {
  normalizeBeerSbtRequest, BEER_BADGES, BEER_SBT_REQ_PREFIX, BEER_SBT_DAY_PREFIX, BEER_SBT_IP_PREFIX,
  BEER_SBT_DAILY_LIMIT, BEER_SBT_DAILY_LIMIT_PER_IP
} from '../src/beer-sbt.js';
import { SBT_REQ_PREFIX, SBT_DAY_PREFIX, SBT_DAILY_LIMIT } from '../src/sbt.js';
import { RANKING_KEY } from '../src/ranking.js';

const ORIGIN = 'https://kawade502.github.io';
const ADDR = '0x52908400098527886E0F7030069857D2E4169EE7';   // EIP-55 の例のアドレス

function makeEnv(enabled = 'true') {
  const store = new Map();
  return {
    store,
    ALLOWED_ORIGINS: ORIGIN,
    SBT_REQUESTS_ENABLED: 'true',
    BEER_SBT_REQUESTS_ENABLED: enabled,
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

const postTo = (path, env, body, headers = {}, ctx) => worker.fetch(new Request('https://api.example' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
}), env, ctx);
const post = (env, body, headers, ctx) => postTo('/beer-sbt-request', env, body, headers, ctx);
const ok = (extra = {}) => ({ address: ADDR, badge: 'joren', cups: 7, consent: true, ...extra });
const xbill = (extra = {}) => ({ address: ADDR, name: 'Alice', score: 12345, consent: true, ...extra });
const keysOf = (env, prefix) => [...env.store.keys()].filter((k) => k.startsWith(prefix) && !k.endsWith('#opts'));
const addr = (i) => '0x' + (i + 1).toString(16).padStart(40, '0');

test('受付: 201 を返し、記念と小文字のアドレスで保存する', async () => {
  const env = makeEnv();
  const res = await post(env, ok());
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const saved = JSON.parse(env.store.get(BEER_SBT_REQ_PREFIX + 'joren:' + ADDR.toLowerCase()));
  assert.equal(saved.address, ADDR.toLowerCase());
  assert.equal(saved.badge, 'joren');
  assert.equal(saved.cups, 7);
  assert.equal(saved.status, 'pending');
  assert.match(saved.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(saved).sort(), ['address', 'badge', 'cups', 'requestedAt', 'status']);
  assert.equal(keysOf(env, SBT_REQ_PREFIX).length, 0);   // XBill の申請には入れない
});

test('記念は3種類。kind は 1〜3、杯数は 2 / 5 / 10', () => {
  assert.deepEqual(Object.keys(BEER_BADGES), ['kanpai', 'joren', 'meiyo']);
  assert.deepEqual(Object.values(BEER_BADGES).map((b) => [b.title, b.cups, b.kind]), [['乾杯', 2, 1], ['常連さん', 5, 2], ['名誉店主', 10, 3]]);
});

test('受付停止中（BEER_SBT_REQUESTS_ENABLED が true 以外）は 503 で、保存しない', async () => {
  for (const v of ['false', '', undefined, 'yes']) {
    const env = makeEnv();
    env.BEER_SBT_REQUESTS_ENABLED = v;
    const res = await post(env, ok());
    assert.equal(res.status, 503, `enabled=${v}`);
    assert.match((await res.json()).error, /受け付けていません/);
    assert.equal(env.store.size, 0);
  }
  const env = makeEnv(' TRUE ');
  assert.equal((await post(env, ok())).status, 201);
});

test('XBill の受付を止めても、ビールジョッキの受付は別に切り替わる', async () => {
  const env = makeEnv();
  env.SBT_REQUESTS_ENABLED = 'false';
  assert.equal((await postTo('/sbt-request', env, xbill())).status, 503);
  assert.equal((await post(env, ok())).status, 201);
  env.SBT_REQUESTS_ENABLED = 'true';
  env.BEER_SBT_REQUESTS_ENABLED = 'false';
  assert.equal((await postTo('/sbt-request', env, xbill())).status, 201);
  assert.equal((await post(env, ok({ badge: 'meiyo', cups: 10 }))).status, 503);
});

test('アドレスの形式が不正なら 400（0 だけのアドレスも）', async () => {
  const env = makeEnv();
  for (const a of ['', '0x123', ADDR.slice(2), ADDR + '0', '0xZZ08400098527886E0F7030069857D2E4169EE7', '0x' + '0'.repeat(40), null, 123, ' ']) {
    const res = await post(env, ok({ address: a }));
    assert.equal(res.status, 400, `address=${a}`);
    assert.match((await res.json()).error, /アドレス/);
  }
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 0);
});

test('知らない記念は 400', async () => {
  const env = makeEnv();
  for (const b of ['', 'Kanpai', 'other', '__proto__', 'constructor', 'toString', null, undefined, 1, ['joren']]) {
    const res = await post(env, ok({ badge: b }));
    assert.equal(res.status, 400, `badge=${b}`);
    assert.match((await res.json()).error, /記念/);
  }
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 0);
});

test('杯数が足りなければ 400。ちょうどなら受け付ける', async () => {
  const env = makeEnv();
  for (const [badge, cups] of [['kanpai', 1], ['joren', 4], ['meiyo', 9], ['kanpai', 0], ['joren', -5]]) {
    const res = await post(env, ok({ badge, cups }));
    assert.equal(res.status, 400, `${badge} cups=${cups}`);
    assert.match((await res.json()).error, /杯数/);
  }
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 0);
  for (const [i, badge] of ['kanpai', 'joren', 'meiyo'].entries()) {
    assert.equal((await post(env, ok({ address: addr(i), badge, cups: BEER_BADGES[badge].cups }))).status, 201, badge);
  }
});

test('杯数が整数でない・多すぎるなら 400', async () => {
  const env = makeEnv();
  for (const c of ['abc', '', ' ', null, undefined, true, [], {}, 100001]) {
    const res = await post(env, ok({ cups: c }));
    assert.equal(res.status, 400, `cups=${JSON.stringify(c)}`);
    assert.match((await res.json()).error, /杯数/);
  }
  assert.equal((await post(env, ok({ cups: 100000 }))).status, 201);
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 1);
});

test('同意が true でなければ 400', async () => {
  const env = makeEnv();
  for (const c of [false, 'true', 1, undefined, null]) {
    const res = await post(env, ok({ consent: c }));
    assert.equal(res.status, 400, `consent=${c}`);
    assert.match((await res.json()).error, /同意/);
  }
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 0);
});

test('杯数は整数に丸め、日時は端末ではなくサーバーの時刻', () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const e = normalizeBeerSbtRequest({ address: ' ' + ADDR + ' ', badge: 'meiyo', cups: '12.9', consent: true, requestedAt: '1999-01-01', status: 'minted' }, now);
  assert.deepEqual(e, { address: ADDR.toLowerCase(), badge: 'meiyo', cups: 12, requestedAt: '2026-10-18T12:00:00.000Z', status: 'pending' });
});

test('同じ記念・同じアドレス（大文字小文字違いも含む）の二度目は 409。別の記念なら受け付ける', async () => {
  const env = makeEnv();
  assert.equal((await post(env, ok())).status, 201);
  const res = await post(env, ok({ address: ADDR.toLowerCase(), cups: 9 }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'このアドレスは、この記念を申請済みです', status: 'duplicate' });
  assert.equal(JSON.parse(env.store.get(BEER_SBT_REQ_PREFIX + 'joren:' + ADDR.toLowerCase())).cups, 7);   // 上書きしない
  assert.equal((await post(env, ok({ badge: 'kanpai' }))).status, 201);
  assert.equal((await post(env, ok({ badge: 'meiyo', cups: 10 }))).status, 201);
  assert.equal((await post(env, ok({ badge: 'kanpai' }))).status, 409);
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 3);
  assert.equal(env.store.get(keysOf(env, BEER_SBT_DAY_PREFIX)[0]), '3');   // 申請済みで断った分は、1日の件数に数えない
});

test('XBill の申請（/sbt-request）とは、申請済みも1日の件数も別に数える', async () => {
  const env = makeEnv();
  assert.equal((await postTo('/sbt-request', env, xbill())).status, 201);
  assert.equal((await post(env, ok())).status, 201);   // XBill で申請済みのアドレスでも受け付ける
  assert.equal((await postTo('/sbt-request', env, xbill())).status, 409);
  assert.equal((await post(env, ok())).status, 409);

  const env2 = makeEnv();
  assert.equal((await post(env2, ok())).status, 201);
  assert.equal((await postTo('/sbt-request', env2, xbill())).status, 201);   // ビールジョッキで申請済みでも受け付ける

  // XBill の1日の上限を使い切っても、ビールジョッキは受け付ける（逆も同じ）
  const env3 = makeEnv();
  for (let i = 0; i < SBT_DAILY_LIMIT; i++) assert.equal((await postTo('/sbt-request', env3, xbill({ address: addr(i) }))).status, 201);
  assert.equal((await postTo('/sbt-request', env3, xbill({ address: addr(999) }))).status, 429);
  assert.equal((await post(env3, ok({ address: addr(999) }))).status, 201);
  assert.equal(env3.store.get(keysOf(env3, BEER_SBT_DAY_PREFIX)[0]), '1');
  assert.equal(env3.store.get(keysOf(env3, SBT_DAY_PREFIX)[0]), String(SBT_DAILY_LIMIT));

  const env4 = makeEnv();
  for (let i = 0; i < BEER_SBT_DAILY_LIMIT; i++) assert.equal((await post(env4, ok({ address: addr(i) }))).status, 201);
  assert.equal((await post(env4, ok({ address: addr(999) }))).status, 429);
  assert.equal((await postTo('/sbt-request', env4, xbill({ address: addr(999) }))).status, 201);
});

test('1日の上限を超えると 429。日付ごとの件数は2日で消える設定', async () => {
  const env = makeEnv();
  for (let i = 0; i < BEER_SBT_DAILY_LIMIT; i++) {
    assert.equal((await post(env, ok({ address: addr(i) }))).status, 201, `#${i}`);
  }
  const res = await post(env, ok({ address: addr(500) }));
  assert.equal(res.status, 429);
  assert.equal((await res.json()).status, 'limit');
  const dayKey = keysOf(env, BEER_SBT_DAY_PREFIX)[0];
  assert.match(dayKey, /^beer:sbt:day:\d{4}-\d{2}-\d{2}$/);
  assert.equal(env.store.get(dayKey), String(BEER_SBT_DAILY_LIMIT));
  assert.equal(JSON.parse(env.store.get(dayKey + '#opts')).expirationTtl, 172800);
});

test('同じ IP からは1日3件まで。別の IP は受け付ける。IP はハッシュで保存する', async () => {
  const env = makeEnv();
  const from = (ip, i) => post(env, ok({ address: addr(i + 100) }), { 'CF-Connecting-IP': ip });
  for (let i = 0; i < BEER_SBT_DAILY_LIMIT_PER_IP; i++) assert.equal((await from('203.0.113.7', i)).status, 201);
  const res = await from('203.0.113.7', 50);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).status, 'limit');
  assert.equal((await from('198.51.100.9', 51)).status, 201);
  for (let i = 0; i < BEER_SBT_DAILY_LIMIT_PER_IP; i++) assert.equal((await from(`2001:db8:1:2::${i + 1}`, 60 + i)).status, 201);
  assert.equal((await from('2001:db8:1:2:dead:beef:0:9', 70)).status, 429);   // IPv6 は /64 ごと
  const ipKeys = keysOf(env, BEER_SBT_IP_PREFIX);
  assert.equal(ipKeys.length, 3);
  assert.ok(ipKeys.every((k) => !k.includes('203.0.113.7') && /^beer:sbt:ip:\d{4}-\d{2}-\d{2}:[0-9a-f]{64}$/.test(k)));
  assert.equal(JSON.parse(env.store.get(ipKeys[0] + '#opts')).expirationTtl, 172800);

  // XBill の申請は、同じ IP でも別に数える
  assert.equal((await postTo('/sbt-request', env, xbill(), { 'CF-Connecting-IP': '203.0.113.7' })).status, 201);
});

test('受け付けたら、XBill と同じ形で運営者に知らせる（名前の欄に記念、スコアの欄に杯数、アドレスは一部だけ）', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('ok', { status: 302 }); };
  try {
    const env = makeEnv();
    assert.equal((await post(env, ok())).status, 201);
    assert.equal(calls.length, 0);   // NOTIFY_URL が無い

    env.NOTIFY_URL = 'https://script.example/exec';
    env.NOTIFY_SECRET = 's3cret';
    assert.equal((await post(env, ok({ address: '0x' + 'ab'.repeat(20), cups: 6 }))).status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://script.example/exec');
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['address', 'name', 'requestedAt', 'score', 'secret']);
    assert.equal(sent.secret, 's3cret');
    assert.equal(sent.name, 'ビールジョッキ「常連さん」');
    assert.equal(sent.score, 6);
    assert.equal(sent.address, '0xabab…abab');
    assert.match(sent.requestedAt, /^\d{4}-\d{2}-\d{2}T/);

    assert.equal((await post(env, ok({ address: '0x' + 'ab'.repeat(20), badge: 'meiyo', cups: 11 }))).status, 201);
    assert.equal(JSON.parse(calls[1].init.body).name, 'ビールジョッキ「名誉店主」');

    // 重複・不正では知らせない
    await post(env, ok({ address: '0x' + 'ab'.repeat(20) }));
    await post(env, ok({ address: 'bad' }));
    await post(env, ok({ badge: 'kanpai', cups: 1 }));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('知らせるのに失敗しても 201。ctx.waitUntil があれば、通知は応答のあとに回す', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const env = makeEnv();
    env.NOTIFY_URL = 'https://script.example/exec';
    env.NOTIFY_SECRET = 's3cret';
    assert.equal((await post(env, ok())).status, 201);
    assert.ok(env.store.get(BEER_SBT_REQ_PREFIX + 'joren:' + ADDR.toLowerCase()));

    let resolveFetch;
    globalThis.fetch = () => new Promise((r) => { resolveFetch = r; });
    const waited = [];
    const res = await post(env, ok({ badge: 'kanpai' }), {}, { waitUntil: (p) => waited.push(p) });
    assert.equal(res.status, 201);   // 通知の完了を待たずに返る
    assert.equal(waited.length, 1);
    resolveFetch(new Response('ok'));
    assert.equal(await waited[0], true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('CORS: 許可した Origin には ACAO を付ける。プリフライト（OPTIONS）は 204', async () => {
  const env = makeEnv();
  const res = await worker.fetch(new Request('https://api.example/beer-sbt-request', {
    method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  assert.equal(env.store.size, 0);

  for (const body of [ok(), ok({ cups: 1 })]) {
    const r = await post(env, body);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(r.headers.get('Vary'), 'Origin');
  }
  const r409 = await post(env, ok());
  assert.equal(r409.status, 409);
  assert.equal(r409.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  const evil = await worker.fetch(new Request('https://api.example/beer-sbt-request', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
});

test('許可外の Origin は 403、本文が大きすぎる・JSON でないなら 400', async () => {
  const env = makeEnv();
  assert.equal((await post(env, ok(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(env, 'nope')).status, 400);
  assert.equal((await post(env, ok({ pad: 'x'.repeat(2000) }))).status, 400);
  assert.equal((await post(env, 'null')).status, 400);
  assert.equal(keysOf(env, BEER_SBT_REQ_PREFIX).length, 0);
});

test('申請の一覧を読む口は無い（GET は 404）。ランキングには影響しない', async () => {
  const env = makeEnv();
  await post(env, ok());
  for (const path of ['/beer-sbt-request', '/beer-sbt-requests', '/beer-sbt']) {
    assert.equal((await worker.fetch(new Request('https://api.example' + path, { headers: { Origin: ORIGIN } }), env)).status, 404, path);
  }
  assert.equal(env.store.has(RANKING_KEY), false);
});
