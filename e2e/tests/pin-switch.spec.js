// @ts-check
// 回归：评论 pin 已打开弹窗时，直接点另一个 pin 必须切换弹窗。
//
// Bug 根因：.pp-anno-popup（z 2147482500）与 pin 同在 .pp-anno-layer 里，pin 无 z-index
// 故弹窗盖在 pin 上 —— 弹窗一旦压住相邻 pin，点它命中的是弹窗而非 pin，pin 的 onclick
// 不触发，弹窗不切换。表现为「时灵时不灵」（取决于弹窗是否恰好盖住目标 pin）。
// 修复：给 pin 设 z-index:2147482600（高于弹窗）。
const { test, expect } = require('@playwright/test');
const { setup, pin, header, goto, mkThread } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('点 pin3 弹出 #3，直接点 pin4 应切到 #4', async ({ page }) => {
  await pin(page, 3).click();
  await expect(header(page)).toHaveText('#3');
  await pin(page, 4).click();
  await expect(header(page)).toHaveText('#4');
});

test('点 pin1 弹出 #1，直接点 pin3 应切到 #3（用户原始复现路径）', async ({ page }) => {
  await pin(page, 1).click();
  await expect(header(page)).toHaveText('#1');
  await pin(page, 3).click();
  await expect(header(page)).toHaveText('#3');
});

test('连续在多个 pin 间切换都应跟手（压力 12 轮）', async ({ page }) => {
  const order = [3, 4, 1, 2, 4, 3, 2, 1, 3, 4, 2, 3];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    await pin(page, n).click();
    await expect(header(page), `第 ${i + 1} 次点击 pin${n}`).toHaveText(`#${n}`);
  }
});
