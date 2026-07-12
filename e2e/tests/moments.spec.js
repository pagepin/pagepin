// @ts-check
// 循环时刻(克制档):
//   M1 轮询发现 site_version 变化 → 顶部「vN 已发布」横幅;
//   M2 轮询发现线程被远程 resolve → pin 原位回执卡(潮环)+ 会话计数;
//   M4 未解决清零 → 抽屉空态变本轮收敛回执。
// 触发轮询:window focus 事件(overlay 的静默刷新监听)。
const { test, expect } = require('@playwright/test');
const { setup, goto, ready, mkThread } = require('./_helpers');

const focusRefresh = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test('M1:site_version 变化 → 新版本横幅;查看按钮存在;9s 自动退场', async ({ page }) => {
  const dyn = { site_version: 'v1', threads: [mkThread(1, '#t1')] };
  await setup(page, { threads: dyn.threads, dyn });
  await goto(page); await ready(page);
  await page.waitForTimeout(200);
  dyn.site_version = 'v2';
  await focusRefresh(page);
  await expect(page.locator('.pp-anno-mtbanner.pp-anno-min')).toBeVisible();
  await expect(page.locator('.pp-anno-mtbanner b')).toContainText('v2');
  await page.locator('.pp-anno-mtbanner .pp-anno-mx').click();
  await expect(page.locator('.pp-anno-mtbanner')).toHaveCount(0);
});

test('M2:远程 resolve → pin 原位回执卡(带处理者署名)', async ({ page }) => {
  const t1 = mkThread(1, '#t1');
  const dyn = { site_version: 'v1', threads: [t1, mkThread(2, '#t2')] };
  await setup(page, { threads: dyn.threads, dyn });
  await goto(page); await ready(page);
  await page.waitForTimeout(200);
  dyn.threads = [
    { ...t1, resolved: true, comments: [...t1.comments, { id: 'r1', author_sub: 'u-agent', author_name: 'agent-claude', text: '已修复', created_at: '2026-06-11T02:00:00+00:00' }] },
    dyn.threads[1],
  ];
  await focusRefresh(page);
  await expect(page.locator('.pp-anno-mreceipt.pp-anno-min')).toBeVisible();
  await expect(page.locator('.pp-anno-mreceipt em')).toHaveText('agent-claude');
});

test('M4:全部解决 → 空态变收敛回执(统计)', async ({ page }) => {
  const t1 = mkThread(1, '#t1');
  const dyn = { site_version: 'v1', threads: [t1] };
  await setup(page, { threads: dyn.threads, dyn });
  await goto(page); await ready(page);
  await page.waitForTimeout(200);
  dyn.threads = [{ ...t1, resolved: true }];
  await focusRefresh(page);
  await expect(page.locator('.pp-anno-mfinale')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.pp-anno-mfinale b')).toBeVisible();
});

test('M3:本地 resolve 盖章(卡片 stamping 过程态)', async ({ page }) => {
  const dyn = { site_version: 'v1', threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] };
  await setup(page, { threads: dyn.threads, dyn });
  await goto(page); await ready(page);
  await page.keyboard.press('j');
  await page.waitForTimeout(300);
  await page.keyboard.press('r');
  await expect(page.locator('.pp-anno-card.pp-anno-stamping')).toHaveCount(1);
  await expect(page.locator('.pp-anno-mstamp')).toBeVisible();
});
