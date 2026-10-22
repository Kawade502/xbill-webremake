// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502

/**
 * 全クリア記念 SBT の申請を受け付ける（POST /sbt-request）。
 *
 *   本文: { address, name, score, consent }
 *   201 受付 / 400 不正 / 409 申請済み / 429 本日の上限 / 503 受付停止中
 *
 * 申請は KV に `sbt:req:<小文字のアドレス>` で保存する。mint は運営者が後日、手元で行う。
 * 申請の一覧を読む API は作らない（運営者は wrangler kv で読む）。
 * 受け付けたら、運営者に Gmail で知らせる（NOTIFY_URL の GAS ウェブアプリへ POST。合言葉は NOTIFY_SECRET。
 * どちらも wrangler secret。設定が無ければ知らせない。知らせるのに失敗しても、申請は成功として返す）。
 * クリアしたかどうかはサーバーで確かめられない（ランキングと同じく自己申告）。最終判断は運営者が行う。
 */
import { ValidationError, cleanName, toInteger, json, readBody, SCORE_MAX } from './ranking.js';
import { overLimit } from './limit.js';

export const SBT_REQ_PREFIX = 'sbt:req:';
export const SBT_DAY_PREFIX = 'sbt:day:';
export const SBT_DAILY_LIMIT = 50;
export const SBT_IP_PREFIX = 'sbt:ip:';
export const SBT_DAILY_LIMIT_PER_IP = 3;   // 1人（同じ IP）が1日の受付枠を使い切れないように
export const NOTIFY_DAY_PREFIX = 'notify:day:';
export const NOTIFY_DAILY_LIMIT = 8;   // 運営者へのメールは1日8通まで（GAS の送信の上限 10 通に余裕を残す。XBill とビールジョッキで共通）
export const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** 受付中か。wrangler.toml の SBT_REQUESTS_ENABLED が "true" のときだけ受け付ける。 */
export function sbtEnabled(env) {
  return String(env.SBT_REQUESTS_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * 申請を検証して、保存する形にする。アドレスは小文字に正規化する
 * （大文字小文字のチェックサムは、mint のときに運営者のツールで検査する）。
 */
export function normalizeSbtRequest(body, now = Date.now()) {
  const address = body && typeof body.address === 'string' ? body.address.trim() : '';
  if (!ADDRESS_RE.test(address)) throw new ValidationError('アドレスの形式が正しくありません');
  if (/^0x0{40}$/i.test(address)) throw new ValidationError('アドレスの形式が正しくありません');
  if (body.consent !== true) throw new ValidationError('注意書きへの同意が必要です');
  const score = toInteger(body.score);
  if (score === null || score < 0 || score > SCORE_MAX) throw new ValidationError('スコアが不正です');

  return {
    address: address.toLowerCase(),
    name: cleanName(body.name),
    score,
    requestedAt: new Date(now).toISOString(),   // クリアした日（= 受け付けた日、UTC）。端末の時計は使わない
    status: 'pending'
  };
}

/**
 * SBT の申請（XBill・ビールジョッキ共通）の、短い時間の回数制限。超えていれば 429 の応答を返す。
 * 同じ送り元は1分3件、全体で1分20件まで（同時にたくさん送って KV の上限をすり抜けるのを止める）。
 */
export async function sbtRateLimited(request, env) {
  const ip = ipForLimit(request.headers.get('CF-Connecting-IP')) || 'unknown';
  if (await overLimit(env.SBT_IP_LIMITER, ip) || await overLimit(env.SBT_ALL_LIMITER, 'all')) {
    return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);
  }
  return null;
}

export async function handleSbtRequest(request, env, ctx, now = Date.now()) {
  if (!sbtEnabled(env)) return json({ error: '現在、申請は受け付けていません' }, 503, request, env);
  const limited = await sbtRateLimited(request, env);
  if (limited) return limited;

  let entry;
  try {
    entry = normalizeSbtRequest(await readBody(request), now);
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: e.message }, 400, request, env);
    throw e;
  }

  const key = SBT_REQ_PREFIX + entry.address;
  if (await env.RANKING.get(key)) return json({ error: 'このアドレスは申請済みです', status: 'duplicate' }, 409, request, env);

  const day = entry.requestedAt.slice(0, 10);
  const dayKey = SBT_DAY_PREFIX + day;
  const count = toInteger(await env.RANKING.get(dayKey)) || 0;
  if (count >= SBT_DAILY_LIMIT) return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);

  // 同じ IP からの申請は1日3件まで（IP はそのまま保存せず、ハッシュにする）。Cloudflare 以外から呼ばれて IP が無いときは数えない
  const ip = ipForLimit(request.headers.get('CF-Connecting-IP'));
  let ipKey = null, ipCount = 0;
  if (ip) {
    ipKey = SBT_IP_PREFIX + day + ':' + await sha256Hex(`${env.NOTIFY_SECRET || ''}|${day}|${ip}`);
    ipCount = toInteger(await env.RANKING.get(ipKey)) || 0;
    if (ipCount >= SBT_DAILY_LIMIT_PER_IP) return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);
  }

  // 数を先に増やしてから、申請を書く（途中で失敗しても、数えずに申請だけ残ることがないように）
  await env.RANKING.put(dayKey, String(count + 1), { expirationTtl: DAY_TTL_SECONDS });
  if (ipKey) await env.RANKING.put(ipKey, String(ipCount + 1), { expirationTtl: DAY_TTL_SECONDS });
  await env.RANKING.put(key, JSON.stringify(entry));

  const notice = notifyOperator(env, entry);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notice);   // 応答を待たせない
  else await notice;
  return json({ ok: true }, 201, request, env);
}

/**
 * 上限を数える単位。IPv4 はアドレスそのもの、IPv6 は先頭 56 ビット（/56）。
 * IPv6 は1回線に膨大な数のアドレスがあり、サーバーの契約では /64 を何百も持てることがあるので、広めに /56 で数える。
 */
export function ipForLimit(ip) {
  if (!ip) return null;
  const text = String(ip).trim().toLowerCase();
  if (!text.includes(':')) return text;
  const [head, tail = ''] = text.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = text.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  const g = groups.slice(0, 4).map((x) => (x || '0').padStart(4, '0'));
  g[3] = g[3].slice(0, 2) + '00';   // 4つ目のまとまりは前半 8 ビットだけ残す（/56）
  return g.map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/56';
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 0x5290…9ee7 の形（メールには全体を載せない） */
export function maskAddress(address) {
  return address.slice(0, 6) + '…' + address.slice(-4);
}

/**
 * 運営者に知らせる。失敗しても例外を投げない。送ったかどうかを返す（テスト用）。
 * extra は、知らせる中身に足す項目（ビールジョッキの申請で、GAS がメールを書き分けるのに使う）。
 */
export async function notifyOperator(env, entry, extra = {}) {
  if (!env.NOTIFY_URL || !env.NOTIFY_SECRET) return false;
  try {
    // 1日の通数を数え、上限を超えたら送らない（申請は KV に残っているので、wrangler の一覧で見られる）
    const dayKey = NOTIFY_DAY_PREFIX + String(entry.requestedAt || new Date().toISOString()).slice(0, 10);
    const sent = toInteger(await env.RANKING.get(dayKey)) || 0;
    if (sent >= NOTIFY_DAILY_LIMIT) return false;
    await env.RANKING.put(dayKey, String(sent + 1), { expirationTtl: DAY_TTL_SECONDS });
    const res = await fetch(env.NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.NOTIFY_SECRET,
        name: entry.name,
        score: entry.score,
        requestedAt: entry.requestedAt,
        address: maskAddress(entry.address),
        ...extra
      }),
      redirect: 'manual'   // GAS は処理のあと別のドメインへ転送する。転送先は読まなくてよい
    });
    return res.status < 400;
  } catch (e) {
    return false;
  }
}
