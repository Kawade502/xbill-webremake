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
 * クリアしたかどうかはサーバーで確かめられない（ランキングと同じく自己申告）。最終判断は運営者が行う。
 */
import { ValidationError, cleanName, toInteger, json, readBody, SCORE_MAX } from './ranking.js';

export const SBT_REQ_PREFIX = 'sbt:req:';
export const SBT_DAY_PREFIX = 'sbt:day:';
export const SBT_DAILY_LIMIT = 20;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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

export async function handleSbtRequest(request, env, now = Date.now()) {
  if (!sbtEnabled(env)) return json({ error: '現在、申請は受け付けていません' }, 503, request, env);

  let entry;
  try {
    entry = normalizeSbtRequest(await readBody(request), now);
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: e.message }, 400, request, env);
    throw e;
  }

  const key = SBT_REQ_PREFIX + entry.address;
  if (await env.RANKING.get(key)) return json({ error: 'このアドレスは申請済みです', status: 'duplicate' }, 409, request, env);

  const dayKey = SBT_DAY_PREFIX + entry.requestedAt.slice(0, 10);
  const count = toInteger(await env.RANKING.get(dayKey)) || 0;
  if (count >= SBT_DAILY_LIMIT) return json({ error: '本日の受付数の上限に達しました。明日もう一度お試しください', status: 'limit' }, 429, request, env);

  await env.RANKING.put(key, JSON.stringify(entry));
  await env.RANKING.put(dayKey, String(count + 1), { expirationTtl: DAY_TTL_SECONDS });
  return json({ ok: true }, 201, request, env);
}
