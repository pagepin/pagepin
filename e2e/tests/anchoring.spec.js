// @ts-check
// 锚点解析降级：选择器失效 / 内容指纹不匹配 / 整页评论，都不渲染 pin，
// 但在 List 弹层以机器可读的 data-pp-status 标注列出（不丢评论）。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread, act, list, ready } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'),                                   // ok → 有 pin
  mkThread(2, '@page'),                                 // 整页评论 → 无 pin（status=page）
  mkThread(3, '#ghost'),                                // 选择器找不到 → lost
  mkThread(4, '#t2', { anchor_text: '创建时这里是另一段完全不同的旧文本' }), // 指纹不匹配 → changed
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await ready(page);
});

test('只有 ok 锚点渲染 pin（@page / lost / changed 都不渲染）', async ({ page }) => {
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  await expect(page.locator('.pp-anno-pin')).toHaveText('1');
});

test('List 列出降级项并标注状态（四条都不丢）', async ({ page }) => {
  await act(page, 'list').click();
  await expect(list(page)).toBeVisible();
  const items = page.locator('[data-pp-role="list-item"]');
  await expect(items).toHaveCount(4);
  // 四种锚点状态各一项（status 机器可读，与文案/i18n 解耦）
  await expect(page.locator('[data-pp-role="list-item"][data-pp-status="ok"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-role="list-item"][data-pp-status="page"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-role="list-item"][data-pp-status="lost"]')).toHaveCount(1);
  await expect(page.locator('[data-pp-role="list-item"][data-pp-status="changed"]')).toHaveCount(1);
  // 降级项给出「锚点丢失」恢复提示
  await expect(list(page)).toContainText('Anchor lost');
});
