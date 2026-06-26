/** R2 条件请求(If-None-Match)回归测试。
 *
 * 背景:浏览器刷新时按 HTTP 规范发送带引号的 If-None-Match(如 `"abc"`),
 * 而 R2 binding 的 `etagDoesNotMatch` 只收「裸 etag」,带引号会抛
 *   TypeError: Conditional ETag should not be wrapped in quotes (...)
 * 该异常既非 NotFoundError 也非 NotModifiedError,曾被顶层兜底成 500
 * (共享图片刷新时间歇 500)。本测试钉死:带引号/弱校验/多值的 header
 * 必须归一化成裸 etag,命中时走 NotModifiedError(→ 304)而非抛错。
 *
 * 运行:node --import tsx --test test/r2-conditional.test.ts(见 package.json test:unit)。
 * FakeBucket 复刻 R2 的真实契约(尤其「带引号即抛 TypeError」),无需真连 R2。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotModifiedError, NotFoundError } from '../src/storage/index.js';
import { R2Storage, parseIfNoneMatch } from '../src/storage/r2.js';

const RAW_ETAG = '66335a22ba5f8b0858e44891d8b33b3b';

function freshBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      c.close();
    },
  });
}

/** 复刻 R2Bucket.get 的真实行为(仅本测试关心的子集)。 */
function fakeBucket(rawEtag = RAW_ETAG, present = true): any {
  return {
    get(_key: string, options?: any) {
      if (!present) return null;
      const cond = options?.onlyIf?.etagDoesNotMatch;
      if (cond !== undefined) {
        // R2 的硬性契约:条件 etag 不能带引号,否则抛 TypeError(就是当初的 500 根因)。
        if (typeof cond === 'string' && cond.includes('"')) {
          throw new TypeError(`Conditional ETag should not be wrapped in quotes (${cond}).`);
        }
        // etagDoesNotMatch:命中(相等)→ 前置条件不满足 → 返回无 body 的对象。
        if (cond === rawEtag) {
          return metaOnly(rawEtag);
        }
      }
      return withBody(rawEtag);
    },
  };
}

function metaOnly(rawEtag: string): any {
  return {
    httpEtag: `"${rawEtag}"`,
    uploaded: new Date('2026-06-11T00:00:00Z'),
    httpMetadata: { contentType: 'image/png' },
    size: 702029,
    body: undefined, // 前置条件未满足 → 无 body
  };
}

function withBody(rawEtag: string): any {
  return {
    httpEtag: `"${rawEtag}"`,
    uploaded: new Date('2026-06-11T00:00:00Z'),
    httpMetadata: { contentType: 'image/png' },
    size: 702029,
    body: freshBody(),
  };
}

test('parseIfNoneMatch 去引号 / 去弱校验前缀 / 多值取首 / *、空 → undefined', () => {
  assert.equal(parseIfNoneMatch(`"${RAW_ETAG}"`), RAW_ETAG);
  assert.equal(parseIfNoneMatch(`W/"${RAW_ETAG}"`), RAW_ETAG);
  assert.equal(parseIfNoneMatch(`"${RAW_ETAG}", "other"`), RAW_ETAG);
  assert.equal(parseIfNoneMatch(RAW_ETAG), RAW_ETAG); // 已是裸值原样返回
  assert.equal(parseIfNoneMatch('*'), undefined);
  assert.equal(parseIfNoneMatch(''), undefined);
  assert.equal(parseIfNoneMatch(undefined), undefined);
});

test('回归:带引号的 If-None-Match 命中 → NotModifiedError(304),不再抛 TypeError(500)', async () => {
  const s = new R2Storage(fakeBucket());
  await assert.rejects(
    () => s.open('screenshots/06-comment-thread.png', { ifNoneMatch: `"${RAW_ETAG}"` }),
    (e: unknown) => {
      assert.ok(
        e instanceof NotModifiedError,
        `期望 NotModifiedError,实得 ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`,
      );
      return true;
    },
  );
});

test('弱校验前缀 W/ 命中 → 同样收敛到 NotModifiedError(304)', async () => {
  const s = new R2Storage(fakeBucket());
  await assert.rejects(
    () => s.open('a.png', { ifNoneMatch: `W/"${RAW_ETAG}"` }),
    (e: unknown) => e instanceof NotModifiedError,
  );
});

test('etag 不匹配 → 返回 body(200 语义)', async () => {
  const s = new R2Storage(fakeBucket());
  const { meta, body } = await s.open('a.png', { ifNoneMatch: '"deadbeef"' });
  assert.equal(meta.contentType, 'image/png');
  assert.ok(body, '应返回可读流');
});

test('无条件头 → 正常返回 body', async () => {
  const s = new R2Storage(fakeBucket());
  const { body } = await s.open('a.png');
  assert.ok(body);
});

test('对象不存在 → NotFoundError', async () => {
  const s = new R2Storage(fakeBucket(RAW_ETAG, /* present */ false));
  await assert.rejects(
    () => s.open('missing.png'),
    (e: unknown) => e instanceof NotFoundError,
  );
});
