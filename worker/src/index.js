// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
// Based on XBill 2.1 (Copyright (C) Brian Wellington, Matias Duarte; GPL). See NOTICE.md.

// Workers の入口。ここでは default export の fetch だけを公開する
// （入口のファイルが定数などを export すると、Workers の実行環境が起動に失敗する）。
// ランキングの処理は ranking.js にある。
import { safeHandle } from './ranking.js';

export default {
  fetch: (request, env, ctx) => safeHandle(request, env, ctx)
};
