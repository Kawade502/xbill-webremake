// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502

/**
 * ビールジョッキ（https://github.com/Kawade502/beer-jug）の、杯数の記念 SBT の申請を受け付ける（POST /beer-sbt-request）。
 *
 *   本文: { address, badge, cups, consent }
 *   201 受付 / 400 不正 / 409 この記念は申請済み / 429 本日の上限 / 503 受付停止中
 *
 * 申請は KV に `beer:sbt:req:<記念>:<小文字のアドレス>` で保存する（同じアドレスでも、記念ごとに1回ずつ申請できる）。
 * 1日の上限と同じ IP からの上限は、XBill の全クリア記念 SBT（sbt.js）とは別に数える。
 * mint は運営者が後日、手元で行う。運営者への知らせは sbt.js と同じ notifyOperator を使う。
 * 杯数は端末の localStorage に貯めた自己申告で、サーバーでは確かめられない。最終判断は運営者が行う。
 */
import { ValidationError, toInteger, json, readBody } from './ranking.js';
import { ADDRESS_RE, DAY_TTL_SECONDS, ipForLimit, sha256Hex, notifyOperator } from './sbt.js';

export const BEER_SBT_REQ_PREFIX = 'beer:sbt:req:';
export const BEER_SBT_DAY_PREFIX = 'beer:sbt:day:';
export const BEER_SBT_DAILY_LIMIT = 50;
export const BEER_SBT_IP_PREFIX = 'beer:sbt:ip:';
export const BEER_SBT_DAILY_LIMIT_PER_IP = 3;
export const CUPS_MAX = 100000;

// 記念の種類。cups はもらえる杯数、kind は mint のときのコントラクトの種類
export const BEER_BADGES = {
  kanpai: { title: '乾杯', cups: 2, kind: 1 },
  joren: { title: '常連さん', cups: 5, kind: 2 },
  meiyo: { title: '名誉店主', cups: 10, kind: 3 }
};

/** 受付中か。wrangler.toml の BEER_SBT_REQUESTS_ENABLED が "true" のときだけ受け付ける。 */
export function beerSbtEnabled(env) {
  return String(env.BEER_SBT_REQUESTS_ENABLED || '').trim().toLowerCase() === 'true';
}

/** 申請を検証して、保存する形にする。アドレスは小文字に正規化する。 */
export function normalizeBeerSbtRequest(body, now = Date.now()) {
  const address = body && typeof body.address === 'string' ? body.address.trim() : '';
  if (!ADDRESS_RE.test(address)) throw new ValidationError('アドレスの形式が正しくありません');
  if (/^0x0{40}$/i.test(address)) throw new ValidationError('アドレスの形式が正しくありません');
  const badge = typeof body.badge === 'string' && Object.hasOwn(BEER_BADGES, body.badge) ? body.badge : null;
  if (!badge) throw new ValidationError('記念の種類が正しくありません');
  const cups = toInteger(body.cups);
  if (cups === null || cups < 0 || cups > CUPS_MAX) throw new ValidationError('杯数が不正です');
  if (cups < BEER_BADGES[badge].cups) throw new ValidationError('杯数が足りません');
  if (body.consent !== true) throw new ValidationError('注意書きへの同意が必要です');

  return {
    address: address.toLowerCase(),
    badge,
    cups,
    requestedAt: new Date(now).toISOString(),   // 受け付けた日（UTC）。端末の時計は使わない
    status: 'pending'
  };
}

export async function handleBeerSbtRequest(request, env, ctx, now = Date.now()) {
  if (!beerSbtEnabled(env)) return json({ error: '現在、申請は受け付けていません' }, 503, request, env);

  let entry;
  try {
    entry = normalizeBeerSbtRequest(await readBody(request), now);
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: e.message }, 400, request, env);
    throw e;
  }

  const key = BEER_SBT_REQ_PREFIX + entry.badge + ':' + entry.address;
  if (await env.RANKING.get(key)) return json({ error: 'このアドレスは、この記念を申請済みです', status: 'duplicate' }, 409, request, env);

  const day = entry.requestedAt.slice(0, 10);
  const dayKey = BEER_SBT_DAY_PREFIX + day;
  const count = toInteger(await env.RANKING.get(dayKey)) || 0;
  if (count >= BEER_SBT_DAILY_LIMIT) return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);

  // 同じ IP からの申請は1日3件まで（sbt.js と同じく、IP はハッシュにして数える）
  const ip = ipForLimit(request.headers.get('CF-Connecting-IP'));
  let ipKey = null, ipCount = 0;
  if (ip) {
    ipKey = BEER_SBT_IP_PREFIX + day + ':' + await sha256Hex(`${env.NOTIFY_SECRET || ''}|${day}|${ip}`);
    ipCount = toInteger(await env.RANKING.get(ipKey)) || 0;
    if (ipCount >= BEER_SBT_DAILY_LIMIT_PER_IP) return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);
  }

  await env.RANKING.put(key, JSON.stringify(entry));
  await env.RANKING.put(dayKey, String(count + 1), { expirationTtl: DAY_TTL_SECONDS });
  if (ipKey) await env.RANKING.put(ipKey, String(ipCount + 1), { expirationTtl: DAY_TTL_SECONDS });

  // 知らせる中身は XBill と同じ形（名前の欄に記念の名前、スコアの欄に杯数）に、ビールジョッキの項目を足す。
  // GAS は app を見て、ビールジョッキ用の件名と本文にする（app を知らない GAS でも、今までどおりのメールになる）
  const badge = BEER_BADGES[entry.badge];
  const notice = notifyOperator(env, {
    name: `ビールジョッキ「${badge.title}」`,
    score: entry.cups,
    requestedAt: entry.requestedAt,
    address: entry.address
  }, {
    app: 'beer-jug',
    badge: entry.badge,
    badgeTitle: badge.title,
    cups: entry.cups,
    kind: badge.kind,
    contract: env.BEER_SBT_CONTRACT || ''
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notice);   // 応答を待たせない
  else await notice;
  return json({ ok: true }, 201, request, env);
}
