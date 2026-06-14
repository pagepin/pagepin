// @ts-check
// 评论深链:#pp-comment-<id> 打开即定位;弹层 🔗 复制带 hash 的当前页链接。
// 回归:深链正则曾是内部版 ObjectId 的 24 位 hex,UUID 形态的 id 永远匹配不上。
const { test, expect } = require('@playwright/test');
const { setup, mkThread, act, popover, list } = require('./_helpers');

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

test('UUID id 的深链:打开页面自动滚到锚点并弹出该线程', async ({ page }) => {
  const t = mkThread(1, '#t3', { id: UUID }); // t3 在 (980,360),默认视口外侧
  await setup(page, { threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(popover(page)).toBeVisible();
  await expect(popover(page).locator('.pp-anno-txt')).toContainText('这是第 1 条评论的内容');
});

test('已解决线程的深链:自动切到「显示全部」再定位', async ({ page }) => {
  const t = mkThread(1, '#t1', { id: UUID, resolved: true });
  await setup(page, { threads: [t] });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(popover(page)).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1); // resolved pin 因深链被显示
});

test('弹层 🔗:复制「当前页去 hash + #pp-comment-<id>」并 toast', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/');

  await page.locator('.pp-anno-pin').click();
  await expect(popover(page)).toBeVisible();
  await popover(page).locator('[data-pp-role="copy-link"]').click();
  await expect(page.locator('[data-pp-role="toast"]')).toContainText('Link copied');
  expect(await page.evaluate(() => window.__copied)).toBe(`http://pagepin.test/#pp-comment-${UUID}`);
});

test('List 行 🔗:复制同样的深链,且不触发整行跳转打开弹层', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } },
    });
  });
  const t = mkThread(1, '#t1', { id: UUID });
  await setup(page, { threads: [t] });
  await page.goto('http://pagepin.test/');

  await act(page, 'list').click();
  const item = page.locator('[data-pp-role="list-item"]');
  await expect(item).toHaveCount(1);
  await item.hover();
  await item.locator('[data-pp-role="copy-link"]').click();
  await expect(page.locator('[data-pp-role="toast"]')).toContainText('Link copied');
  expect(await page.evaluate(() => window.__copied)).toBe(`http://pagepin.test/#pp-comment-${UUID}`);
  await expect(popover(page)).toHaveCount(0); // stopPropagation:没开弹层
});
