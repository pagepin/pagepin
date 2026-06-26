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
  put(
    key: string,
    data: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ): Promise<void>;
  /** 服务端 copy(同存储),不经应用流量(fs 为本地复制)。 */
  copy(src: string, dst: string): Promise<void>;
  /** head 探活(图片查看器壳返回前确认对象存在,避免给 404 包壳)。 */
  exists(key: string): Promise<boolean>;
  /** prefix 下全部文件的相对 key(旧版本文件清单懒回填用)。
   * 可选能力:fs 实现;S3 等不实现的驱动 → 回填跳过,图片导航优雅缺席。 */
  list?(prefix: string): Promise<string[]>;
  /** 删除该前缀下的全部对象(站点删除/管理员下架时回收存储)。
   * 可选能力:fs / r2 实现;S3 等不实现的驱动 → 调用方跳过(尽力而为,DB 软删才是真相源)。 */
  deletePrefix?(prefix: string): Promise<void>;
  /** 404 → NotFoundError,ETag 命中 → NotModifiedError。 */
  open(
    key: string,
    opts?: { ifNoneMatch?: string },
  ): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }>;
}

/** 回收一个站点全部版本的存储对象 —— 前缀 `sites/<ownerId>/<slug>/` 覆盖该站所有 version。
 * 尽力而为:驱动无 deletePrefix 能力则跳过;删除报错只 warn 不抛(软删/吊销已是真相源,
 * 不能因存储回收失败而让删除/下架接口 500)。 */
export async function purgeSiteStorage(
  storage: Storage,
  ownerId: string,
  slug: string,
): Promise<void> {
  if (!storage.deletePrefix) return;
  const prefix = `sites/${ownerId}/${slug}/`;
  try {
    await storage.deletePrefix(prefix);
  } catch (e) {
    console.warn(`存储回收失败 ${prefix}:`, e);
  }
}
