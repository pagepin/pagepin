/** 存储抽象 —— 纯接口(edge-safe,无 Node 依赖)。Node 工厂在 storage/factory.ts。 */

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
