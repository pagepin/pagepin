// @ts-check
// 桌面 v3 状态参考截图(供设计对标用,非断言测试)。
// 跑法:pnpm exec playwright test tests/desktop-shots.spec.js
// 产物:test-results/desktop-shots/d1..d7.png(1600×900,抽屉自动展开档)
const { test } = require('@playwright/test');
const { mkThread, setup, goto, pin, drawer, tab, draft, focusedCard, ready } =
  require('./_helpers');

test.use({ viewport: { width: 1600, height: 900 } });

const SHOTS = 'test-results/desktop-shots';
const shot = (page, name) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

const THREADS = [
  mkThread(1, '#t1', {
    anchor_text: 't1',
    comments: [
      { id: 'c1', author_sub: 'u-author', author_name: '李产品', text: '这里的措辞对客户来说太技术了,换成人话', created_at: '2026-06-11T00:00:00+00:00' },
      { id: 'c1r', author_sub: 'u-tester', author_name: '测试者', text: '收到,下一版改', created_at: '2026-06-11T01:00:00+00:00' },
    ],
  }),
  mkThread(2, '#t2', { kind: 'style', anchor_text: 't2' }),
  mkThread(3, '#t3', { resolved: true, anchor_text: 't3' }),
];

test('d1 概览:抽屉展开 + 页面 pin + 已解决态', async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page); await ready(page);
  await pin(page, 1).waitFor();
  await shot(page, 'd1-overview');
});

test('d2 聚焦:发光相机 + 卡片就地展开', async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page); await ready(page);
  await page.keyboard.press('j');
  await focusedCard(page).waitFor();
  await page.waitForTimeout(700); // 等 glow bloom 动画落定
  await shot(page, 'd2-focused');
});

test('d3 评论模式:十字光标悬停锚点', async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page); await ready(page);
  await page.keyboard.press('c');
  await page.locator('#t4').hover();
  await page.waitForTimeout(300);
  await shot(page, 'd3-comment-mode');
});

test('d4 草稿:抽屉草稿卡', async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page); await ready(page);
  await page.keyboard.press('c');
  await page.locator('#t4').click();
  await draft(page).waitFor();
  await draft(page).locator('textarea').fill('按钮和标题的间距太挤了');
  await page.waitForTimeout(400);
  await shot(page, 'd4-draft');
});

test('d5 收起:右缘 tab', async ({ page }) => {
  await setup(page, { threads: THREADS });
  await goto(page); await ready(page);
  await page.keyboard.press('\\');
  await tab(page).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'd5-collapsed');
});

test('d6 guest 视角:控件收敛 + 署名', async ({ page }) => {
  await setup(page, {
    threads: THREADS,
    viewer: { sub: 'guest:g-abc123', name: null, handle: null, guest: true },
  });
  await goto(page); await ready(page);
  await page.keyboard.press('j');
  await focusedCard(page).waitFor();
  await page.waitForTimeout(700);
  await shot(page, 'd6-guest');
});

test('d7 退化态:stale 徽标 + 锚点丢失卡', async ({ page }) => {
  await setup(page, {
    threads: [
      mkThread(1, '#t1', { version_id: 'v0', anchor_text: 't1' }), // 版本不匹配 → stale
      mkThread(2, '#nope', { anchor_text: '早已不在的元素' }), // 选择器失效 → 锚点丢失
      mkThread(3, '#t2', { anchor_text: 't2' }),
    ],
  });
  await goto(page); await ready(page);
  await page.locator('.pp-anno-pin').first().waitFor();
  await shot(page, 'd7-degraded');
});
