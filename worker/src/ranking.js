// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
// Based on XBill 2.1 (Copyright (C) Brian Wellington, Matias Duarte; GPL). See NOTICE.md.

/**
 * XBill Web Remake のランキング API（Cloudflare Workers + KV）。
 * src/code.gs（GAS 版）と同じ規則でスコアを検証し、上位 20 件を KV の 1 キーに保存する。
 *
 *   GET  /ranking  -> { ranking: [...上位10件] }
 *   POST /score    -> { ranking: [...上位10件], rank }   本文: { name, score, level, cleared }
 *   POST /sbt-request -> 全クリア記念 SBT の申請（sbt.js）
 *
 * ランキングはクライアントから申告されたスコアをそのまま保存する遊び用途のものです。
 * 改ざんは防げないため、値の範囲チェックと件数の上限だけを設けています。
 * KV には排他制御がなく、反映に最大 1 分ほどかかることがあります（同時登録が重なると、まれに 1 件失われます）。
 */

import { handleSbtRequest } from './sbt.js';

export const RANKING_KEY = 'ranking';
export const RANKING_STORE_MAX = 20;
export const RANKING_RETURN_MAX = 10;
export const NAME_MAX_LENGTH = 12;
export const DEFAULT_NAME = 'NO NAME';
export const SCORE_MAX = 10000000;
export const LEVEL_MAX = 99;
export const BODY_MAX_BYTES = 1024;

// 制御文字・ゼロ幅文字・双方向制御文字（code.gs の cleanName_ と同じ範囲）に加え、
// 見えない書式文字（ソフトハイフン・単語結合子・異体字セレクター・タグ文字など）も除く
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

export class ValidationError extends Error {}

/** 制御文字などを除いて trim し、12 文字（コードポイント単位）に切る。空なら NO NAME。 */
export function cleanName(name) {
  const text = String(name == null ? '' : name).replace(INVISIBLE, '').trim();
  const clipped = Array.from(text).slice(0, NAME_MAX_LENGTH).join('').trim();
  return clipped || DEFAULT_NAME;
}

/** 数値、または数字だけの文字列を整数にする。null・未指定・真偽値・空文字などは null（不正）。 */
export function toInteger(v) {
  const isNumeric = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
  if (!isNumeric) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function normalizeEntry(body, now = Date.now()) {
  const score = toInteger(body && body.score);
  if (score === null || score < 0 || score > SCORE_MAX) throw new ValidationError('スコアが不正です');
  const level = toInteger(body && body.level);
  if (level === null || level < 1 || level > LEVEL_MAX) throw new ValidationError('レベルが不正です');

  return { name: cleanName(body && body.name), score, level, cleared: body.cleared === true, at: now };
}

/** スコア降順。同点は先に登録された方を上位にする。 */
export function compareEntries(a, b) {
  return (b.score - a.score) || (a.at - b.at);
}

function isValidEntry(e) {
  return !!e && typeof e.name === 'string' &&
    Number.isFinite(e.score) && Number.isFinite(e.level) && Number.isFinite(e.at);
}

async function readRanking(env) {
  let list;
  try {
    list = await env.RANKING.get(RANKING_KEY, 'json');
  } catch (e) {
    return [];
  }
  return Array.isArray(list) ? list.filter(isValidEntry).sort(compareEntries) : [];
}

// ---- HTTP ----

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

export function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) }
  });
}

export async function readBody(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > BODY_MAX_BYTES) throw new ValidationError('リクエストが大きすぎます');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) throw new ValidationError('リクエストが大きすぎます');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ValidationError('JSON を読み取れません');
  }
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // ブラウザからの書き込みは、許可した Origin だけ（Origin の無い curl などは通る。GAS 版と同じく誰でも登録できる）
  if (request.method === 'POST' && origin && !allowedOrigins(env).includes(origin)) {
    return json({ error: '許可されていない Origin です' }, 403, request, env);
  }

  if (request.method === 'GET' && url.pathname === '/ranking') {
    const ranking = (await readRanking(env)).slice(0, RANKING_RETURN_MAX);
    return json({ ranking }, 200, request, env);
  }

  if (request.method === 'POST' && url.pathname === '/score') {
    let entry;
    try {
      entry = normalizeEntry(await readBody(request));
    } catch (e) {
      if (e instanceof ValidationError) return json({ error: e.message }, 400, request, env);
      throw e;
    }

    const ranking = await readRanking(env);
    ranking.push(entry);
    ranking.sort(compareEntries);
    const stored = ranking.slice(0, RANKING_STORE_MAX);
    await env.RANKING.put(RANKING_KEY, JSON.stringify(stored));

    const top = stored.slice(0, RANKING_RETURN_MAX);
    return json({ ranking: top, rank: top.indexOf(entry) + 1 }, 200, request, env);
  }

  if (request.method === 'POST' && url.pathname === '/sbt-request') {
    return handleSbtRequest(request, env, ctx);
  }

  return json({ error: 'Not Found' }, 404, request, env);
}

/** 想定外の例外は 500 にして、Worker が落ちないようにする。 */
export async function safeHandle(request, env, ctx) {
  try {
    return await handleRequest(request, env, ctx);
  } catch (e) {
    return json({ error: 'サーバーでエラーが起きました' }, 500, request, env);
  }
}
