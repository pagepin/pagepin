// @ts-check
// 评论深链:#pp-comment-<id> 打开即定位;弹窗 🔗 复制带 hash 的当前页链接。
// 回归:深链正则曾是内部版 ObjectId 的 24 位 hex,UUID 形态的 id 永远匹配不上。
const { test, expect } = require('@playwright/test');
const { setup, mkThread } = require('./_helpers');

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('UUID id 的深链:打开页面自动滚到锚点并弹出该线程', async ({ page }) => {
  const t = mkThread(1, '#t3', { id: UUID }); // t3 在 (980,360),默认视口外侧
  await setup(page, { threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(page.locator('.pp-anno-popup')).toBeVisible();
  await expect(page.locator('.pp-anno-popup .pp-anno-txt')).toContainText('这是第 1 条评论的内容');
});

test('已解决线程的深链:自动打开「显示已解决」再定位', async ({ page }) => {
  const t = mkThread(1, '#t1', { id: UUID, resolved: true });
  await setup(page, { threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(page.locator('.pp-anno-popup')).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1); // resolved pin 因深链被显示
});

test('弹窗 🔗:复制「当前页去 hash + #pp-comment-<id>」并 toast', async ({ page }) => {
  // 劫持 clipboard 捕获写入内容(http 非安全上下文本无 clipboard API)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/');

  await page.locator('.pp-anno-pin').click();
  await expect(page.locator('.pp-anno-popup')).toBeVisible();
  await page.locator('.pp-anno-ops button[title*="复制"]').click();
  await expect(page.locator('.pp-anno-toast')).toContainText('链接已复制');
  expect(await page.evaluate(() => window.__copied)).toBe(
    `http://pagepin.test/#pp-comment-${UUID}`,
  );
});

test('侧栏行 🔗:复制同样的深链,且不触发整行跳转打开弹窗', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/');

  await page.locator('.pp-anno-toolbar button', { hasText: '列表' }).click();
  const item = page.locator('.pp-anno-sb-item');
  await expect(item).toHaveCount(1);
  await item.hover();
  await item.locator('.pp-anno-sb-link').click();
  await expect(page.locator('.pp-anno-toast')).toContainText('链接已复制');
  expect(await page.evaluate(() => window.__copied)).toBe(
    `http://pagepin.test/#pp-comment-${UUID}`,
  );
  await expect(page.locator('.pp-anno-popup')).toHaveCount(0); // stopPropagation:没开弹窗
});
