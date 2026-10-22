// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502

/**
 * 短い時間の回数制限（Cloudflare Workers の Rate Limiting binding。wrangler.toml の [[ratelimits]]）。
 * KV の数え方（読んでから書く）は、同時にたくさん送られるとすり抜けられるので、その前にこれで止める。
 * binding が無い環境（テスト・手元の確認）や、binding が失敗したときは制限しない。
 */
export async function overLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return false;
  try {
    const { success } = await binding.limit({ key });
    return success === false;
  } catch (e) {
    return false;
  }
}
