// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Kawade502
// src/game.html の EIP-55（アドレスのチェックサム）と Keccak-256 の実装を、既知の値で検査する。
//   node tools/check_eip55.mjs
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/game.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ @eip55-begin[^\n]*\n([\s\S]*?)\/\/ @eip55-end/);
if (!m) throw new Error('@eip55-begin / @eip55-end が見つかりません');
const { keccak256Hex, toChecksumAddress, checksumOk } =
  new Function(m[1] + '; return { keccak256Hex, toChecksumAddress, checksumOk };')();

let bad = 0;
const eq = (actual, expected, label) => {
  if (actual !== expected) { bad++; console.error(`NG ${label}: ${actual} !== ${expected}`); }
};
const enc = (s) => new TextEncoder().encode(s);
eq(keccak256Hex(enc('')), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'keccak("")');
eq(keccak256Hex(enc('abc')), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'keccak("abc")');
// EIP-55 の仕様書の例
for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  '0x52908400098527886E0F7030069857D2E4169EE7']) {
  eq(toChecksumAddress(a.toLowerCase()), a, `checksum ${a}`);
  eq(checksumOk(a), true, `checksumOk ${a}`);
}
eq(checksumOk('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'), false, '1文字の大文字小文字違いを見つける');
eq(checksumOk('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), true, 'すべて小文字は検査しない');
eq(checksumOk('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'), true, 'すべて大文字は検査しない');
console.log(bad ? `${bad} 件の不一致` : 'OK');
process.exitCode = bad ? 1 : 0;
