/** Node 入口用的存储工厂(动态 import fs/s3,Node only)。
 * 与接口分离:storage/index.ts 保持纯接口(edge-safe),Workers 入口自带 R2 驱动不走这里。 */

import type { Config } from '../config.js';
import type { Storage } from './index.js';

export async function createStorage(cfg: Config): Promise<Storage> {
  if (cfg.storage === 's3') {
    const { S3Storage } = await import('./s3.js');
    return new S3Storage(cfg.s3!);
  }
  const { FsStorage } = await import('./fs.js');
  return new FsStorage(cfg.dataDir);
}
