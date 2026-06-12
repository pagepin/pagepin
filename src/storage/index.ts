/** 存储抽象 —— 唯一入口(put/copy/exists + 流式 open)。 */

import type { Config } from '../config.js';

export interface ObjectMeta {
  etag?: string;
  lastModified?: string;
  contentType: string;
  contentLength?: number;
}

export class NotFoundError extends Error {}
export class NotModifiedError extends Error {}

export interface Storage {
  put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, contentType: string): Promise<void>;
  /** 服务端 copy(同存储),不经应用流量(fs 为本地复制)。 */
  copy(src: string, dst: string): Promise<void>;
  /** head 探活(图片查看器壳返回前确认对象存在,避免给 404 包壳)。 */
  exists(key: string): Promise<boolean>;
  /** prefix 下全部文件的相对 key(旧版本文件清单懒回填用)。
   * 可选能力:fs 实现;S3 等不实现的驱动 → 回填跳过,图片导航优雅缺席。 */
  list?(prefix: string): Promise<string[]>;
  /** 404 → NotFoundError,ETag 命中 → NotModifiedError。 */
  open(key: string, opts?: { ifNoneMatch?: string }): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }>;
}

/** Node 入口用的工厂;Workers 入口自带 R2 驱动,不走这里。 */
export async function createStorage(cfg: Config): Promise<Storage> {
  if (cfg.storage === 's3') {
    const { S3Storage } = await import('./s3.js');
    return new S3Storage(cfg.s3!);
  }
  const { FsStorage } = await import('./fs.js');
  return new FsStorage(cfg.dataDir);
}
