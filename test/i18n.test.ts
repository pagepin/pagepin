/** i18n 目录不变量守护:
 *   1) 每个域文件 en/zh key 集合完全一致(漏译即失败)。
 *   2) 跨域文件无重复 key(避免聚合时静默覆盖)。
 *   3) src/ 里经 ApiError / jsonError / errorBody / t() 引用的每个 key 都在合并目录中存在
 *      (en+zh 都有)——抓住「改了源文件却忘了补 catalog」。
 *   4) normalizeLocale 对 Accept-Language / 简写的解析符合预期。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

import { MESSAGE_PARTS, messages } from '../src/i18n/messages.js';
import { normalizeLocale, SUPPORTED } from '../src/i18n/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

test('每个域文件 en/zh key 集合一致', () => {
  for (const part of MESSAGE_PARTS) {
    const en = Object.keys(part.en).sort();
    const zh = Object.keys(part.zh).sort();
    assert.deepEqual(en, zh, 'en/zh key 集合不一致(漏译): ' + JSON.stringify({ en, zh }));
  }
});

test('合并目录 en/zh key 集合一致', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort());
});

test('跨域文件无重复 key', () => {
  const seen = new Map<string, number>();
  for (const part of MESSAGE_PARTS) {
    for (const k of Object.keys(part.en)) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dups, [], '重复 key: ' + dups.join(', '));
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'generated') continue; // 生成产物不扫
      out.push(...walk(p));
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** 从源码里抠出经 i18n 助手引用的 key(仅取点分 key,降低误报)。 */
function referencedKeys(): Set<string> {
  const keys = new Set<string>();
  const patterns = [
    /\bnew ApiError\(\s*\d+\s*,\s*'([^']+)'/g,
    /\bjsonError\(\s*[A-Za-z_$][\w$]*\s*,\s*\d+\s*,\s*'([^']+)'/g,
    /\berrorBody\(\s*[^,]+?,\s*'([^']+)'/g,
    /\bt\(\s*[^,'"]+?,\s*'([^']+)'/g,
  ];
  for (const file of walk(SRC)) {
    if (file.includes(path.join('src', 'i18n', 'messages'))) continue; // 目录本身
    const text = readFileSync(file, 'utf8');
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const k = m[1];
        if (k && k.includes('.')) keys.add(k);
      }
    }
  }
  return keys;
}

test('src/ 引用的每个 i18n key 都在目录中(en+zh)', () => {
  const missing: string[] = [];
  for (const k of referencedKeys()) {
    if (!(k in messages.en) || !(k in messages.zh)) missing.push(k);
  }
  assert.deepEqual(missing.sort(), [], '目录缺失的 key: ' + missing.join(', '));
});

// ———————————————— console SPA catalog(独立工程,运行时纯数据可直接 import)————————————————

const CONSOLE_SRC = path.resolve(here, '../console/src');

async function loadConsole(): Promise<{
  MESSAGE_PARTS: Array<Record<'en' | 'zh', Record<string, string>>>;
  messages: Record<'en' | 'zh', Record<string, string>>;
}> {
  return (await import('../console/src/i18n/messages.ts')) as never;
}

test('console: 每个域文件 en/zh 一致 + 跨域无重复', async () => {
  const { MESSAGE_PARTS } = await loadConsole();
  const seen = new Map<string, number>();
  for (const part of MESSAGE_PARTS) {
    assert.deepEqual(
      Object.keys(part.en).sort(),
      Object.keys(part.zh).sort(),
      'console 域文件 en/zh 不一致',
    );
    for (const k of Object.keys(part.en)) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dups, [], 'console 重复 key: ' + dups.join(', '));
});

test('console: src 引用的每个 key 都在目录中', async () => {
  const { messages } = await loadConsole();
  const keys = new Set<string>();
  const reCalls = [/\bt\(\s*'([^']+)'/g, /\btranslate\(\s*'([^']+)'/g];
  const walkTsx = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'i18n') continue;
        out.push(...walkTsx(p));
      } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
    }
    return out;
  };
  for (const f of walkTsx(CONSOLE_SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const re of reCalls)
      for (const m of text.matchAll(re)) if (m[1]?.includes('.')) keys.add(m[1]);
  }
  const missing = [...keys].filter((k) => !(k in messages.en) || !(k in messages.zh));
  assert.deepEqual(missing.sort(), [], 'console 目录缺失的 key: ' + missing.join(', '));
});

test('normalizeLocale 解析', () => {
  assert.equal(normalizeLocale('zh-CN,zh;q=0.9,en;q=0.8'), 'zh');
  assert.equal(normalizeLocale('en-US,en;q=0.9'), 'en');
  assert.equal(normalizeLocale('zh'), 'zh');
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh');
  assert.equal(normalizeLocale('EN'), 'en');
  assert.equal(normalizeLocale('fr-FR'), undefined);
  assert.equal(normalizeLocale(''), undefined);
  assert.equal(normalizeLocale(undefined), undefined);
  // q 排序:英文权重更高时取 en
  assert.equal(normalizeLocale('zh;q=0.5,en;q=0.9'), 'en');
  for (const l of SUPPORTED) assert.equal(normalizeLocale(l), l);
});
