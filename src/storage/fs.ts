/** 本地文件系统驱动(Node only)—— 自托管默认存储,`docker run -v data:/data` 即跑。 */

import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { NotFoundError, NotModifiedError, type ObjectMeta, type Storage } from './index.js';
import { guessContentType } from './mime.js';

export class FsStorage implements Storage {
  private root: string;

  constructor(dataDir: string) {
    this.root = resolve(dataDir, 'sites-data');
  }

  /** key 由服务端拼接、rel 已过 normalizeSitePath;这里仍兜一道穿越防御。 */
  private fileFor(key: string): string {
    if (key.includes('\0') || key.split('/').includes('..')) {
      throw new Error(`非法存储 key:${key}`);
    }
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new Error(`存储 key 越界:${key}`);
    }
    return p;
  }

  async put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, _contentType: string): Promise<void> {
    const file = this.fileFor(key);
    await mkdir(dirname(file), { recursive: true });
    if (data instanceof Uint8Array) {
      await pipeline(Readable.from(Buffer.from(data)), createWriteStream(file));
    } else {
      await pipeline(Readable.fromWeb(data as never), createWriteStream(file));
    }
  }

  async copy(src: string, dst: string): Promise<void> {
    const to = this.fileFor(dst);
    await mkdir(dirname(to), { recursive: true });
    try {
      await copyFile(this.fileFor(src), to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(src);
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const st = await stat(this.fileFor(key));
      return st.isFile();
    } catch {
      return false;
    }
  }

  async open(key: string, opts?: { ifNoneMatch?: string }): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    const file = this.fileFor(key);
    let st;
    try {
      st = await stat(file);
    } catch {
      throw new NotFoundError(key);
    }
    if (!st.isFile()) throw new NotFoundError(key);
    const etag = `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    if (opts?.ifNoneMatch && opts.ifNoneMatch === etag) throw new NotModifiedError(key);
    const meta: ObjectMeta = {
      etag,
      lastModified: st.mtime.toUTCString(),
      contentType: guessContentType(key),
      contentLength: st.size,
    };
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return { meta, body };
  }
}

/** 测试/工具用:把 web 流聚成 Buffer(生产路径不依赖)。 */
export async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(
    Readable.fromWeb(stream as never),
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    }),
  );
  return Buffer.concat(chunks);
}
