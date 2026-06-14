// @ts-check
// 回归：评论 pin 已打开弹层时，直接点另一个 pin 必须切换弹层。
// 根因：弹层会盖住相邻 pin → pin 点不到。修复：pin z-index 高于弹层（2147482600 > 2147482500）。
const { test, expect } = require('@playwright/test');
const { setup, pin, popover, goto, mkThread } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

// 弹层暴露 data-pp-num（点击 pin 进入 Walk 后，当前线程的 pin 号），用于断言「显示的是哪条」
const atPin = (page, n) => expect(popover(page)).toHaveAttribute('data-pp-num', String(n));

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('点 pin3 弹出 #3，直接点 pin4 应切到 #4', async ({ page }) => {
  await pin(page, 3).click();
  await atPin(page, 3);
  await pin(page, 4).click();
  await atPin(page, 4);
});

test('点 pin1 弹出 #1，直接点 pin3 应切到 #3（用户原始复现路径）', async ({ page }) => {
  await pin(page, 1).click();
  await atPin(page, 1);
  await pin(page, 3).click();
  await atPin(page, 3);
});

test('连续在多个 pin 间切换都应跟手（压力 12 轮）', async ({ page }) => {
  const order = [3, 4, 1, 2, 4, 3, 2, 1, 3, 4, 2, 3];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    await pin(page, n).click();
    await expect(popover(page), `第 ${i + 1} 次点击 pin${n}`).toHaveAttribute('data-pp-num', String(n));
  }
});
