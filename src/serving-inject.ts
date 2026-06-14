/** HTMLRewriter 流式注入(Workers only —— 全局 HTMLRewriter,Node 无此 API)。
 *
 * 给 serving 的「>5MB HTML」注入路径用,去掉字节注入的 5MB 整读上限:不把整页读进内存,
 * 边解析边在 <head> 末尾追加 comments.js 标签。≤5MB 仍走 serving.ts 的字节级注入
 * (跨运行时一致、保非 UTF-8/BOM 原样)—— 故本路径只是大页面的逃生通道。
 *
 * 注入位置与字节注入对齐:head 末尾(等价 </head> 前);无 head 落 body 末尾。
 * ⚠️ HTMLRewriter 假定 UTF-8;非 UTF-8 的 >5MB 页面极罕见,此处不保 lossless ——
 *    要 lossless 请保持文件 ≤5MB 走字节注入。
 *
 * 本文件不进 Node 构建图(tsup 入口 index.ts 不引它),且被 base tsconfig 排除。 */

/** 把 tag 流式注入到 resp 的 HTML 里;保留 resp 的状态与响应头。 */
export function htmlRewriterInject(resp: Response, tag: string): Response {
  let injected = false;
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(tag, { html: true }); // head 末尾 = </head> 前
        injected = true;
      },
    })
    .on('body', {
      element(el) {
        if (!injected) {
          el.append(tag, { html: true }); // 无 head 的页面兜底
          injected = true;
        }
      },
    })
    .transform(resp);
}
