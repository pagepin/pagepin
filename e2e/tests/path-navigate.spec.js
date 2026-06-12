// @ts-check
// pagepin:navigate(图片查看器壳的 lightbox 就地切换)与评论层的契约:
// 切路径 → 重拉线程、后续新建评论落在新路径;composer 有草稿 → preventDefault 阻断。
const { test, expect } = require('@playwright/test');
const { setup, goto } = require('./_helpers');

const SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#9ab"/></svg>',
);

const IMG_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>html,body{margin:0;height:900px}#shot{position:absolute;left:100px;top:120px;width:400px;height:300px}</style>
</head><body>
<img id="shot" src="data:image/svg+xml,${SVG}" alt="shot">
<script src="/comments.js" data-handle="alice" data-slug="demo" data-path="a.png" data-version="v1"></script>
</body></html>`;

const navigateTo = (page, path) =>
  page.evaluate(
    (p) => dispatchEvent(new CustomEvent('pagepin:navigate', { cancelable: true, detail: { path: p } })),
    path,
  );

test('切路径:按新 path 重拉线程,之后新建的评论落在新路径', async ({ page }) => {
  let created = null;
  await setup(page, { html: IMG_HTML, onCreate: (b) => { created = b; } });
  await goto(page);
  await expect(page.locator('.pp-anno-toolbar')).toBeVisible();

  const refetch = page.waitForRequest((r) => r.url().includes('path=b.png'));
  const proceeded = await navigateTo(page, 'b.png');
  expect(proceeded).toBe(true); // 无草稿,切换放行
  await refetch;

  await page.keyboard.press('c');
  await page.mouse.click(300, 270);
  await expect(page.locator('.pp-anno-popup')).toBeVisible();
  await page.fill('.pp-anno-popup textarea', '新图上的意见');
  await page.click('.pp-anno-send');
  await expect.poll(() => created && created.path).toBe('b.png');
});

test('composer 有未发草稿:切换被 preventDefault 阻断,弹窗仍在;放弃草稿后放行', async ({ page }) => {
  await setup(page, { html: IMG_HTML });
  await goto(page);
  await expect(page.locator('.pp-anno-toolbar')).toBeVisible();
  await page.keyboard.press('c');
  await page.mouse.click(300, 270);
  await expect(page.locator('.pp-anno-popup')).toBeVisible();
  await page.fill('.pp-anno-popup textarea', '还没写完的草稿');

  const blocked = await navigateTo(page, 'b.png');
  expect(blocked).toBe(false); // preventDefault → dispatchEvent 返回 false
  await expect(page.locator('.pp-anno-popup')).toBeVisible(); // 草稿弹窗没被关

  await page.keyboard.press('Escape'); // 明确放弃草稿
  await expect(page.locator('.pp-anno-popup')).toHaveCount(0);
  const proceeded = await navigateTo(page, 'b.png');
  expect(proceeded).toBe(true);
});

test('同路径/空路径事件:no-op,不重拉', async ({ page }) => {
  await setup(page, { html: IMG_HTML });
  await goto(page);
  await expect(page.locator('.pp-anno-toolbar')).toBeVisible();

  let refetched = false;
  page.on('request', (r) => { if (r.url().includes('/api/comments/') && r.method() === 'GET') refetched = true; });
  expect(await navigateTo(page, 'a.png')).toBe(true); // 同路径:放行但不动
  expect(await page.evaluate(() => dispatchEvent(new CustomEvent('pagepin:navigate', { cancelable: true, detail: {} })))).toBe(true);
  await page.waitForTimeout(300);
  expect(refetched).toBe(false);
});
