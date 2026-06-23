/** R2 binding 驱动(官方服务用)—— 实现 Storage 接口,原生绑定无需签名/凭证。
 * 自托管走 storage/fs.ts;BYO 桶(R2-over-S3 / MinIO)走 storage/s3.ts。
 * 注:本文件仅 Workers 构建编译(base tsconfig 排除,tsconfig.workers.json 收)。 */

import { NotFoundError, NotModifiedError, type ObjectMeta, type Storage } from './index.js';
import { guessContentType } from './mime.js';
import type { R2Bucket, R2ObjectBody } from '@cloudflare/workers-types';

/** If-None-Match header → R2 etagDoesNotMatch 可接受的「裸 etag」。
 * 处理:外层引号、W/ 弱校验前缀、逗号分隔多值(取首个,单资源 serving 已足够)。
 * 返回 undefined 表示无法用作条件(空 / `*`),调用方退化为无条件 get。 */
export function parseIfNoneMatch(header?: string): string | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed === '' || trimmed === '*') return undefined;
  const first = trimmed.split(',')[0]?.trim() ?? '';
  const tag = first.replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
  return tag.length ? tag : undefined;
}

export class R2Storage implements Storage {
  private prefix: string;
  constructor(private bucket: R2Bucket, prefix = '') {
    this.prefix = prefix.replace(/^\/+/, '');
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  async put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, contentType: string): Promise<void> {
    // R2 原生 put 直收 ReadableStream/Uint8Array,免聚合(不像 s3 驱动要整体算 SigV4 hash)。
    await this.bucket.put(this.k(key), data as never, { httpMetadata: { contentType } });
  }

  async copy(src: string, dst: string): Promise<void> {
    // R2 binding 无服务端 copy:read→put(唯一调用点是「根唯一 html → index.html 别名」,单个小文件)。
    const obj = await this.bucket.get(this.k(src));
    const body = (obj as R2ObjectBody | null)?.body;
    if (!obj || !body) throw new NotFoundError(src);
    await this.bucket.put(this.k(dst), body as never, {
      httpMetadata: { contentType: obj.httpMetadata?.contentType ?? guessContentType(dst) },
    });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.bucket.head(this.k(key))) !== null;
  }

  /** prefix 下全部相对 key(图片清单回填用)。R2 list 分页 + 2000 封顶(对齐 serving.ts)。 */
  async list(prefix: string): Promise<string[]> {
    const full = this.k(prefix);
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.bucket.list({ prefix: full, cursor, limit: 1000 });
      for (const o of res.objects) out.push(o.key.slice(full.length));
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor && out.length < 2000);
    return out.sort();
  }

  /** 删除前缀下全部对象(站点删除/下架回收)。分页列举,每批 ≤1000 一次性 delete;
   * 不设 list 的 2000 封顶 —— 回收要清干净,翻到没有 cursor 为止。 */
  async deletePrefix(prefix: string): Promise<void> {
    const full = this.k(prefix);
    let cursor: string | undefined;
    do {
      const res = await this.bucket.list({ prefix: full, cursor, limit: 1000 });
      const keys = res.objects.map((o) => o.key);
      if (keys.length) await this.bucket.delete(keys);
      cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
  }

  async open(
    key: string,
    opts?: { ifNoneMatch?: string },
  ): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    // 浏览器按 HTTP 规范发送带引号(可能带 W/ 弱校验前缀、逗号分隔多值)的 If-None-Match,
    // 但 R2 的 etagDoesNotMatch 只收「裸 etag」,带引号会抛 TypeError → 兜底成 500。
    // 故在此把 header 归一化成不带引号的裸 etag;`*` 或空值则退化为无条件 get。
    const inm = parseIfNoneMatch(opts?.ifNoneMatch);
    const obj = await this.bucket.get(
      this.k(key),
      inm ? { onlyIf: { etagDoesNotMatch: inm } } : undefined,
    );
    if (!obj) throw new NotFoundError(key);
    const body = (obj as R2ObjectBody).body;
    if (!body) throw new NotModifiedError(key); // onlyIf 未满足(etag 命中)→ 无 body = 304
    const meta: ObjectMeta = {
      etag: obj.httpEtag,
      lastModified: obj.uploaded.toUTCString(),
      contentType: obj.httpMetadata?.contentType ?? guessContentType(key),
      contentLength: obj.size,
    };
    return { meta, body: body as unknown as ReadableStream<Uint8Array> };
  }
}
