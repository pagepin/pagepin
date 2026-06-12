// @ts-check
// 锚点解析降级：选择器失效 / 内容指纹不匹配 / 整页评论，都不渲染 pin，
// 但在侧边栏以对应状态提示列出（不丢评论）。
const { test, expect } = require('@playwright/test');
const { setup, goto, mkThread } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'),                                   // ok → 有 pin
  mkThread(2, '@page'),                                 // 整页评论 → 无 pin
  mkThread(3, '#ghost'),                                // 选择器找不到 → lost
  mkThread(4, '#t2', { anchor_text: '创建时这里是另一段完全不同的旧文本' }), // 指纹不匹配 → changed
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await expect(page.locator('.pp-anno-toolbar')).toBeVisible();
});

test('只有 ok 锚点渲染 pin（@page / lost / changed 都不渲染）', async ({ page }) => {
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
  await expect(page.locator('.pp-anno-pin')).toHaveText('1');
});

test('侧边栏列出降级项并标注状态', async ({ page }) => {
  await page.locator('.pp-anno-toolbar button', { hasText: '列表' }).click();
  const sb = page.locator('.pp-anno-sidebar');
  await expect(sb).toContainText('整页意见');
  await expect(sb).toContainText('原锚点丢失');
  await expect(sb).toContainText('页面内容已变化');
  // 四条评论都在侧边栏（不因锚点失效而丢失）
  await expect(page.locator('.pp-anno-sb-item')).toHaveCount(4);
});
