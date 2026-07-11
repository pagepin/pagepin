// @ts-check
// Tideline（移动端形态）：iPhone 12 视口（390×844，coarse pointer + touch）下的 bottom sheet 交互模型。
//   - 激活：coarse 且短边 ≤640（或宽 ≤520）→ root[data-pp-form="tideline"]，不再注入桌面抽屉；
//   - sheet 三档 detent（data-pp-detent=peek|half|full）：整条 peek bar 轻点开合、Pointer 拖拽就近吸附；
//   - 右拇指角常驻「+ Note」FAB → AIM 瞄准模式（压暗 + 可锚定元素点亮 + 底部指令条 + 最近锚点吸附）；
//   - 打点后草稿落在 sheet（HALF），相机把锚点停在 sheet 上方空明区；
//   - guest 模式在 sheet 里同样成立（无 resolve/kind 控件、composer 带署名输入）；
//   - 深链 #pp-comment-<id> 落地：sheet 抬到 half + 相机取景；
//   - 图片框选走 Pointer Events（pointerType=touch 也可框选，GROWTH-PLAN A4）。
// 截图：关键状态存 e2e/test-results/tideline-shots/（PEEK/HALF/FULL/AIM/draft/guest）。
const path = require('path');
const { test, expect, devices } = require('@playwright/test');
const { setup, mkThread, fixtureHtml, NOW, focusedCard, draft, cards, pin } = require('./_helpers');

const iphone = devices['iPhone 12']; // 390×844
test.use({
  viewport: iphone.viewport,
  userAgent: iphone.userAgent,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: iphone.isMobile,
  hasTouch: iphone.hasTouch,
  // 测试默认关动画（detent 过渡/平滑滚动即时完成，断言稳定）；peek-bounce 单测另开非 reduce 环境
  reducedMotion: 'reduce',
});

const SHOT = (name) => path.join(__dirname, '../test-results/tideline-shots', name);

// 390px 宽下的锚点布局：纵向排布、全部在 PEEK 档 sheet（top=768）上方
const MOBILE_BOXES = [
  { id: 't1', left: 20, top: 80 }, { id: 't2', left: 20, top: 240 },
  { id: 't3', left: 20, top: 400 }, { id: 't4', left: 20, top: 560 },
];

const sheet = (page) => page.locator('[data-pp-role="sheet"]');
const grab = (page) => page.locator('[data-pp-role="sheet-grab"]');
const fab = (page) => page.locator('[data-pp-role="fab"]');
const aimHint = (page) => page.locator('[data-pp-role="aim-hint"]');
const aimDim = (page) => page.locator('[data-pp-role="aim-dim"]');
const aimTargets = (page) => page.locator('[data-pp-role="aim-target"]');

async function gotoMobile(page) {
  await page.goto('http://pagepin.test/');
  await sheet(page).waitFor();
}

/** detent 断言：属性 + 几何都到位（属性同步更新，但 CSS transition 要过帧才真挪 ——
 *  紧跟着的页面 tap 若在过渡半途会打在 sheet 上被忽略）。 */
async function waitDetent(page, d) {
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', d);
  const vh = await page.evaluate(() => innerHeight);
  const hs = { peek: 76, half: Math.round(vh * 0.56), full: Math.round(vh * 0.92) };
  await expect(async () => {
    const b = await sheet(page).boundingBox();
    expect(Math.abs(b.y - (vh - hs[d]))).toBeLessThan(3);
  }).toPass();
}

/** 拖 sheet 把手到目标 y（Pointer 拖拽 → 就近吸附 detent）。 */
async function dragSheetTo(page, targetY) {
  const box = await grab(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, targetY, { steps: 8 });
  await page.mouse.up();
}

test('形态激活：Tideline sheet + FAB 注入，桌面抽屉/收起 tab 不再出现（初始 PEEK）', async ({ page }) => {
  await setup(page, { boxes: MOBILE_BOXES, threads: [mkThread(1, '#t1'), mkThread(2, '#t2')] });
  await gotoMobile(page);

  await expect(page.locator('.pp-anno-root')).toHaveAttribute('data-pp-form', 'tideline');
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'peek');
  await expect(page.locator('[data-pp-role="drawer"]')).toHaveCount(0);
  await expect(page.locator('[data-pp-role="tab"]')).toHaveCount(0);

  // FAB：右拇指角、常驻、触控目标 ≥40px
  await expect(fab(page)).toBeVisible();
  const fb = await fab(page).boundingBox();
  expect(fb.height).toBeGreaterThanOrEqual(40);
  expect(fb.x + fb.width / 2).toBeGreaterThan(390 / 2); // 在右半屏（拇指角）

  // peek bar 显示计数；pin 照常渲染在页面上
  await expect(page.locator('[data-pp-role="sheet-meta"]')).toContainText('2');
  await expect(page.locator('.pp-anno-pin')).toHaveCount(2);
  await page.screenshot({ path: SHOT('01-peek.png') });
});

test('detent 切换：轻点 peek bar → HALF，拖到顶 → FULL，拖回底 → PEEK', async ({ page }) => {
  await setup(page, { boxes: MOBILE_BOXES, threads: [mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3')] });
  await gotoMobile(page);
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'peek');

  // 轻点整条 peek bar（不是 5px 小把手）→ HALF
  await grab(page).tap();
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'half');
  await expect(cards(page).first()).toBeVisible();
  await page.screenshot({ path: SHOT('02-half.png') });

  // 拖到接近顶部 → 就近吸附 FULL
  await dragSheetTo(page, 80);
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'full');
  await page.screenshot({ path: SHOT('03-full.png') });

  // 拖回底部 → PEEK
  await dragSheetTo(page, 800);
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'peek');
});

test('AIM 打点：FAB → 压暗+点亮+指令条；离目标的点吸附最近锚点；草稿在 sheet HALF；发送建线程', async ({ page }) => {
  const creates = [];
  await setup(page, { boxes: MOBILE_BOXES, threads: [], onCreate: (b) => creates.push(b) });
  await gotoMobile(page);

  await fab(page).tap();
  // AIM：sheet 落回 PEEK，压暗层 + 4 个可锚定元素点亮 + 底部指令条（带取消）
  await waitDetent(page, 'peek');
  await expect(aimDim(page)).toHaveCount(1);
  await expect(aimTargets(page)).toHaveCount(4);
  await expect(aimHint(page)).toBeVisible();
  await page.screenshot({ path: SHOT('04-aim.png') });

  // 粗拇指点在 #t1（20,80 170×70）外侧上方 → 吸附到最近锚点 #t1，绝不落 @page
  await page.touchscreen.tap(250, 60);
  await expect(draft(page)).toBeVisible();
  await expect(draft(page)).toHaveAttribute('data-pp-selector', '#t1');
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'half');
  // AIM 已退出（压暗/点亮/指令条撤掉）
  await expect(aimDim(page)).toHaveCount(0);
  await expect(aimTargets(page)).toHaveCount(0);
  await expect(aimHint(page)).toHaveCount(0);
  await page.screenshot({ path: SHOT('05-draft.png') });

  await draft(page).locator('textarea').fill('手机上打的第一个点');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].selector).toBe('#t1');
  expect(creates[0].rx).toBeGreaterThanOrEqual(0);
  expect(creates[0].rx).toBeLessThanOrEqual(1);
  expect(creates[0].text).toBe('手机上打的第一个点');
  // 新线程聚焦在 sheet 里，pin 上屏
  await expect(focusedCard(page)).toBeVisible();
  await expect(page.locator('.pp-anno-pin')).toHaveCount(1);
});

test('AIM 直接命中元素：rx/ry 是点在元素内的相对位置；取消按钮退出 AIM', async ({ page }) => {
  const creates = [];
  await setup(page, { boxes: MOBILE_BOXES, threads: [], onCreate: (b) => creates.push(b) });
  await gotoMobile(page);

  // 取消路径
  await fab(page).tap();
  await expect(aimHint(page)).toBeVisible();
  await aimHint(page).locator('[data-pp-role="aim-cancel"]').click();
  await expect(aimHint(page)).toHaveCount(0);
  await expect(aimDim(page)).toHaveCount(0);

  // 命中 #t2（20,240 170×70）中心
  await fab(page).tap();
  await waitDetent(page, 'peek');
  await expect(aimDim(page)).toHaveCount(1);
  await page.touchscreen.tap(105, 275);
  await expect(draft(page)).toHaveAttribute('data-pp-selector', '#t2');
  await draft(page).locator('textarea').fill('直接命中');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].selector).toBe('#t2');
  expect(creates[0].rx).toBeCloseTo(0.5, 1);
  expect(creates[0].ry).toBeCloseTo(0.5, 1);
});

test('guest 模式：sheet 内无 resolve/reopen/kind 控件；composer 带署名输入；FAB 可用', async ({ page }) => {
  const GUEST = { sub: 'guest:g-abc123', name: null, handle: null, guest: true };
  await setup(page, {
    boxes: MOBILE_BOXES,
    threads: [mkThread(1, '#t1'), mkThread(2, '#t2', { resolved: true })],
    viewer: GUEST,
  });
  await gotoMobile(page);

  await expect(fab(page)).toBeVisible(); // guest 可创建
  await pin(page, 1).tap(); // 点 pin → sheet 抬到 half + 聚焦卡展开
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'half');
  await expect(focusedCard(page)).toBeVisible();
  await expect(page.locator('[data-pp-role="resolve"]')).toHaveCount(0);
  await expect(page.locator('[data-pp-role="reopen"]')).toHaveCount(0);
  await expect(focusedCard(page).locator('[data-pp-kind]')).toHaveCount(0);
  await expect(focusedCard(page).locator('[data-pp-role="guest-name"]')).toBeVisible();
  await page.screenshot({ path: SHOT('06-guest.png') });

  // AIM 草稿同样带署名输入（先等 sheet 从 half 真正落回 peek + AIM 就绪，再打点）
  await fab(page).tap();
  await waitDetent(page, 'peek');
  await expect(aimDim(page)).toHaveCount(1);
  await page.touchscreen.tap(105, 435); // #t3
  await expect(draft(page)).toHaveAttribute('data-pp-selector', '#t3');
  await expect(draft(page).locator('[data-pp-role="guest-name"]')).toBeVisible();
});

test('深链落地：sheet 抬到 HALF、聚焦该卡，相机把锚点停在 sheet 上方空明区', async ({ page }) => {
  const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const boxes = [{ id: 't3', left: 20, top: 1080 }];
  await setup(page, {
    threads: [mkThread(1, '#t3', { id: UUID })],
    html: fixtureHtml(boxes, 2400), // 页面够长才有滚动余量做取景
  });
  await page.goto(`http://pagepin.test/#pp-comment-${UUID}`);

  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page)).toHaveAttribute('data-tid', UUID);
  await expect(sheet(page)).toHaveAttribute('data-pp-detent', 'half');
  // 空明区取景：锚点元素完整落在视口顶与 sheet 顶边之间
  await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector('#t3').getBoundingClientRect();
    const st = document.querySelector('[data-pp-role="sheet"]').getBoundingClientRect().top;
    return r.top >= 0 && r.bottom <= st + 1;
  })).toBe(true);
  await page.screenshot({ path: SHOT('07-deeplink.png') });
});

test('触屏图片框选（Pointer Events）：pointerType=touch 拖拽出框 → 区域评论 rw/rh 上报', async ({ page }) => {
  const SVG = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="225"><rect width="300" height="225" fill="#9ab"/></svg>',
  );
  const IMG_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:1200px}#shot{position:absolute;left:20px;top:120px;width:300px;height:225px}</style>
</head><body>
<img id="shot" src="data:image/svg+xml,${SVG}" alt="shot">
<script src="/comments.js" data-handle="alice" data-slug="demo" data-path="/" data-version="v1"></script>
</body></html>`;
  const creates = [];
  await setup(page, { html: IMG_HTML, onCreate: (b) => creates.push(b) });
  await gotoMobile(page);

  await fab(page).tap(); // AIM = 评论模式
  await expect(aimDim(page)).toHaveCount(1);

  // 合成 touch pointer 序列：img(20,120 300×225) 上从 (60,160) 拖到 (260,310)
  await page.evaluate(() => {
    const img = document.querySelector('#shot');
    const ev = (type, x, y, buttons) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, button: 0, buttons,
    });
    img.dispatchEvent(ev('pointerdown', 60, 160, 1));
    img.dispatchEvent(ev('pointermove', 150, 230, 1));
    img.dispatchEvent(ev('pointermove', 260, 310, 1));
    img.dispatchEvent(ev('pointerup', 260, 310, 0));
  });

  await expect(draft(page)).toBeVisible();
  await expect(draft(page)).toHaveAttribute('data-pp-selector', '#shot');
  await draft(page).locator('textarea').fill('这块区域再亮一点');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].rx).toBeCloseTo(40 / 300, 2);
  expect(creates[0].ry).toBeCloseTo(40 / 225, 2);
  expect(creates[0].rw).toBeCloseTo(200 / 300, 2);
  expect(creates[0].rh).toBeCloseTo(150 / 225, 2);
  await expect(page.locator('.pp-anno-region')).toHaveCount(1);
});

test('聚焦卡步进器：上一条/下一条按钮（j/k 的触屏对应物）＋ n/m 位置', async ({ page }) => {
  await setup(page, { boxes: MOBILE_BOXES, threads: [mkThread(1, '#t1'), mkThread(2, '#t2'), mkThread(3, '#t3')] });
  await gotoMobile(page);
  await pin(page, 1).tap();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '1');
  await expect(focusedCard(page).locator('[data-pp-role="step-pos"]')).toHaveText('1 / 3');
  await focusedCard(page).locator('[data-pp-role="step-next"]').click();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '2');
  await expect(focusedCard(page).locator('[data-pp-role="step-pos"]')).toHaveText('2 / 3');
  await focusedCard(page).locator('[data-pp-role="step-prev"]').click();
  await expect(focusedCard(page)).toHaveAttribute('data-pp-num', '1');
});

test.describe('非 reduced-motion 环境', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('挂载后 sheet 一次性 peek-bounce 自我教学（reduced-motion 时会跳过）', async ({ page }) => {
    await setup(page, { boxes: MOBILE_BOXES, threads: [mkThread(1, '#t1')] });
    await gotoMobile(page);
    await expect(sheet(page)).toHaveClass(/pp-anno-nudge/, { timeout: 2000 }); // ~600ms 后出现
    await expect(sheet(page)).not.toHaveClass(/pp-anno-nudge/, { timeout: 2000 }); // ~800ms 后撤掉
  });
});
