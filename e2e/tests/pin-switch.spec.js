// @ts-check
// 点 pin = 在抽屉里聚焦该线程卡（就地展开），直接点另一个 pin 必须切到另一张卡。
// 回归根因（保留）：弹层/卡会盖住相邻 pin → pin 点不到。pin z-index 高于其它覆盖层。
const { test, expect } = require('@playwright/test');
const { setup, pin, focusedCard, goto, mkThread, ready } = require('./_helpers');

const THREADS = [
  mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3'), mkThread(4, '#t4'),
];

// 聚焦展开的卡暴露 data-pp-num（= 该线程的 pin 号），用于断言「当前在看哪条」
const atPin = (page, n) => expect(focusedCard(page)).toHaveAttribute('data-pp-num', String(n));

test.beforeEach(async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(4);
});

test('点 pin3 聚焦 #3，直接点 pin4 应切到 #4', async ({ page }) => {
  await pin(page, 3).click();
  await atPin(page, 3);
  await pin(page, 4).click();
  await atPin(page, 4);
});

test('点 pin1 聚焦 #1，直接点 pin3 应切到 #3（用户原始复现路径）', async ({ page }) => {
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
    await expect(focusedCard(page), `第 ${i + 1} 次点击 pin${n}`).toHaveAttribute('data-pp-num', String(n));
  }
});
