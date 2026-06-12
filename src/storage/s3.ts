/** S3 兼容驱动(SigV4 自实现,WebCrypto,edge-safe)—— R2 / MinIO / OSS / S3 通吃。
 * 不引 AWS SDK:本驱动只需要 PUT/GET/HEAD/COPY 四个动作,签名 ~100 行。
 */

import { NotFoundError, NotModifiedError, type ObjectMeta, type Storage } from './index.js';
import type { S3Config } from '../config.js';

const enc = new TextEncoder();

function hex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 段编码(S3 canonical URI 要求;'/' 保留)。 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

export class S3Storage implements Storage {
  private cfg: S3Config;
  private origin: string; // https://host[:port]
  private basePath: string; // path-style 时为 /bucket,否则 ''

  constructor(cfg: S3Config) {
    this.cfg = { ...cfg, prefix: cfg.prefix.replace(/^\/+/, '') };
    const ep = cfg.endpoint.includes('://') ? cfg.endpoint : `https://${cfg.endpoint}`;
    const u = new URL(ep);
    if (cfg.forcePathStyle) {
      this.origin = u.origin;
      this.basePath = `/${cfg.bucket}`;
    } else {
      this.origin = `${u.protocol}//${cfg.bucket}.${u.host}`;
      this.basePath = '';
    }
  }

  private async signedFetch(
    method: string,
    key: string,
    opts: { body?: Uint8Array; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const path = `${this.basePath}/${encodeKey(this.cfg.prefix + key)}`;
    const url = `${this.origin}${path}`;
    const host = new URL(this.origin).host;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(opts.body ?? new Uint8Array(0));

    const headers: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const signedNames = Object.keys(headers).sort();
    const canonicalHeaders = signedNames.map((k) => `${k}:${headers[k]!.trim()}\n`).join('');
    const signedHeaders = signedNames.join(';');

    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

    let k: ArrayBuffer | Uint8Array = enc.encode('AWS4' + this.cfg.secretKey);
    for (const part of [dateStamp, this.cfg.region, 's3', 'aws4_request']) k = await hmac(k, part);
    const signature = hex(await hmac(k, stringToSign));

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const { host: _h, ...sendHeaders } = headers; // host 由 fetch 自动带,不能手设
    return fetch(url, {
      method,
      headers: { ...sendHeaders, authorization },
      body: opts.body as BodyInit | undefined,
    });
  }

  async put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, contentType: string): Promise<void> {
    // SigV4 需要 payload hash:流先聚合(deploy 单文件 ≤ 限额,可接受;大文件直传是 v1.1 的 presigned)
    const body = data instanceof Uint8Array ? data : new Uint8Array(await new Response(data).arrayBuffer());
    const res = await this.signedFetch('PUT', key, { body, headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`S3 PUT ${key} 失败:HTTP ${res.status} ${await res.text()}`);
  }

  async copy(src: string, dst: string): Promise<void> {
    const copySource = `/${this.cfg.bucket}/${encodeKey(this.cfg.prefix + src)}`;
    const res = await this.signedFetch('PUT', dst, { headers: { 'x-amz-copy-source': copySource } });
    if (res.status === 404) throw new NotFoundError(src);
    if (!res.ok) throw new Error(`S3 COPY ${src} → ${dst} 失败:HTTP ${res.status} ${await res.text()}`);
    await res.body?.cancel();
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.signedFetch('HEAD', key);
    await res.body?.cancel();
    return res.ok;
  }

  async open(key: string, opts?: { ifNoneMatch?: string }): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    const headers: Record<string, string> = {};
    if (opts?.ifNoneMatch) headers['if-none-match'] = opts.ifNoneMatch;
    const res = await this.signedFetch('GET', key, { headers });
    if (res.status === 304) {
      await res.body?.cancel();
      throw new NotModifiedError(key);
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new NotFoundError(key);
    }
    if (!res.ok || !res.body) throw new Error(`S3 GET ${key} 失败:HTTP ${res.status}`);
    const len = res.headers.get('content-length');
    const meta: ObjectMeta = {
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: len ? Number(len) : undefined,
    };
    return { meta, body: res.body as ReadableStream<Uint8Array> };
  }
}
