// @ts-check
// 身份门禁：评论层只对登录访客注入，匿名/关评论时不留痕迹。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, drawer } = require('./_helpers');

test('匿名访客（/api/viewer 401）：完全不注入任何 UI', async ({ page }) => {
  await setup(page, { viewerStatus: 401, threads: [mkThread(1, '#t1')] });
  await goto(page);
  await page.waitForResponse((r) => r.url().endsWith('/api/viewer'));
  await expect(page.locator('.pp-anno-root')).toHaveCount(0);
  await expect(drawer(page)).toHaveCount(0);
});

test('站点已关评论（线程列表 403）：注入后自我移除', async ({ page }) => {
  await setup(page, { threadsStatus: 403, threads: [mkThread(1, '#t1')] });
  await goto(page);
  await page.waitForResponse((r) => /\/api\/comments\/[^/]+\/[^/]+\?/.test(r.url()));
  await expect(page.locator('.pp-anno-root')).toHaveCount(0);
});

test('已登录访客：注入右侧抽屉 + pin', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
});
