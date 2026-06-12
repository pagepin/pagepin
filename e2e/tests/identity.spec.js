// @ts-check
// 身份门禁：评论层只对登录访客注入，匿名/关评论时不留痕迹。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread } = require('./_helpers');

test('匿名访客（/api/viewer 401）：完全不注入任何 UI', async ({ page }) => {
  await setup(page, { viewerStatus: 401, threads: [mkThread(1, '#t1')] });
  await goto(page);
  // boot() 在 viewer 抛错处直接 return，buildUI 从不执行
  await page.waitForResponse((r) => r.url().endsWith('/api/viewer'));
  await expect(page.locator('.pp-anno-root')).toHaveCount(0);
  await expect(page.locator('.pp-anno-toolbar')).toHaveCount(0);
});

test('站点已关评论（线程列表 403）：注入后自我移除', async ({ page }) => {
  await setup(page, { threadsStatus: 403, threads: [mkThread(1, '#t1')] });
  await goto(page);
  // 先 buildUI，fetchThreads 拿到 403 → root.remove()
  await page.waitForResponse((r) => /\/api\/comments\/[^/]+\/[^/]+\?/.test(r.url()));
  await expect(page.locator('.pp-anno-root')).toHaveCount(0);
});

test('已登录访客：注入工具栏', async ({ page }) => {
  await setup(page, { threads: [mkThread(1, '#t1')] });
  await goto(page);
  await expect(page.locator('.pp-anno-toolbar')).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
});
