// @ts-check
// 文本选区评论(设计稿 onPageMouseUp/_findQuote):评论模式选中文字 → 引文草稿 →
// POST 带 quote → 命中行高亮条 + pin 挂行尾;原文改动 → 锚点丢失(评论仍在)。
const { test, expect } = require('@playwright/test');
const { setup, goto, ready, mkThread, draft, dock, focusedCard, pin } = require('./_helpers');

const SENT = '这里有一段可以选中的正文文字，用来验证文本锚点的完整链路。';
const BOXES = [{ id: 't1', left: 40, top: 60, text: SENT }];
const QUOTE = '可以选中的正文文字';

// 在 #t1 内构造 QUOTE 选区;withClick 时补派发合成 click(真实交互里选区拖拽的
// mouseup 自带 click;Playwright 的真实 click 会先 mousedown 把选区塌掉,所以走合成事件)
async function selectQuote(page, withClick = true) {
  await page.evaluate(({ q, wc }) => {
    const host = document.getElementById('t1');
    const textNode = host.firstChild;
    const i = textNode.nodeValue.indexOf(q);
    const r = document.createRange();
    r.setStart(textNode, i);
    r.setEnd(textNode, i + q.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    if (wc) host.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, { q: QUOTE, wc: withClick });
}

test('评论模式选中文字 → 引文草稿 → 发布 POST 带 quote,渲染高亮条 + 行尾 pin', async ({ page }) => {
  let created = null;
  await setup(page, { boxes: BOXES, threads: [], onCreate: (b) => (created = b) });
  await goto(page);
  await ready(page);
  await dock(page).locator('[data-pp-act="comment"]').click(); // 进评论模式
  await selectQuote(page);
  // 草稿气泡带引文条与「Text anchor」脚标
  await expect(draft(page)).toBeVisible();
  await expect(draft(page).locator('.pp-anno-dbubble-quote')).toContainText(QUOTE);
  await expect(draft(page).locator('.pp-anno-dbubble-sel')).toContainText('Text anchor');
  await draft(page).locator('textarea').fill('这个说法要再确认一下');
  await draft(page).locator('[data-pp-role="send"]').click();
  // POST 携带 quote 与宿主 selector
  await expect.poll(() => created && created.quote).toBe(QUOTE);
  expect(created.selector).toContain('t1');
  // 命中行高亮条(窄盒内 quote 会折行 → ≥1 条) + pin 文本为作者缩写、挂在最后一条右侧行尾
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
  await expect(pin(page, 1)).toBeVisible();
  const hl = await page.locator('.pp-anno-hlrect').last().boundingBox();
  const pb = await pin(page, 1).boundingBox();
  expect(pb.x).toBeGreaterThan(hl.x + hl.width - 2); // pin 在高亮条右侧
});

test('quote 线程:高亮条可点聚焦,popover 显示引文;原文改动 → 锚点丢失徽章', async ({ page }) => {
  const t = mkThread(1, '#t1', { quote: QUOTE });
  await setup(page, { boxes: BOXES, threads: [t] });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
  await page.locator('.pp-anno-hlrect').first().click({ position: { x: 4, y: 4 } }); // 点高亮条左端(行尾 pin 悬在右侧上方) = 聚焦
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-pop-sel')).toContainText(QUOTE);
  // 原文被改(quote 检索不到)→ 高亮/pin 撤下;重新聚焦后卡带「锚点丢失」徽章,评论仍在
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('t1').textContent = '整段文字被 agent 重写了'; });
  await expect(page.locator('.pp-anno-hlrect')).toHaveCount(0);
  await expect(page.locator('.pp-anno-pin')).toHaveCount(0);
  await page.keyboard.press('j'); // 锚点丢失线程仍可从 j/k 聚焦
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-badge-lost')).toBeVisible();
  await expect(focusedCard(page).locator('.pp-anno-txt')).toContainText('这是第 1 条评论的内容');
});

test('托盘头部:版本序数徽章 v3(不再显示 UUID);筛选钮无数字', async ({ page }) => {
  await setup(page, { boxes: BOXES, threads: [mkThread(1, '#t1')], versionN: 3 });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-tray-ver')).toHaveText('v3');
  await expect(page.locator('.pp-anno-tray-open')).toContainText('1');
  await expect(page.locator('[data-pp-filter="open"]')).toHaveText('Open');
  await expect(page.locator('[data-pp-filter="all"]')).toHaveText('All');
});

test('意图跟随:悬停文字 I-beam 撤描边,悬停留白亮元素框;脏拖不误打点;模式内无浮钮', async ({ page }) => {
  await setup(page, { boxes: BOXES, threads: [] });
  await goto(page);
  await ready(page);
  await dock(page).locator('[data-pp-act="comment"]').click();
  // 指针压在文字字形上 → 文本意图:html 带 text-intent,元素描边撤下
  const glyph = await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('t1').firstChild);
    const rc = r.getClientRects()[0];
    return { x: rc.left + 8, y: rc.top + rc.height / 2 };
  });
  await page.mouse.move(glyph.x, glyph.y);
  await expect(page.locator('html')).toHaveClass(/pp-anno-text-intent/);
  await expect(page.locator('.pp-anno-hover-hint')).toHaveCount(0);
  // 指针落到盒子右下角留白 → 元素意图:描边回来
  const box = await page.locator('#t1').boundingBox();
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 6);
  await expect(page.locator('html')).not.toHaveClass(/pp-anno-text-intent/);
  await expect(page.locator('#t1')).toHaveClass(/pp-anno-hover-hint/);
  // 脏拖(空白处拖了一段但没选到字)→ 不打点、无草稿
  await page.mouse.move(600, 600);
  await page.mouse.down();
  await page.mouse.move(660, 640, { steps: 4 });
  await page.mouse.up();
  await expect(draft(page)).toHaveCount(0);
  // 模式内选字不出浮钮(直通草稿的入口是带选区的 mouseup)
  await selectQuote(page, false);
  await page.waitForTimeout(450);
  await expect(page.locator('[data-pp-role="quote-chip"]')).toHaveCount(0);
});

test('模式外随选随评:选中文字浮出泪滴钮 → 点击进引文草稿并发布;Esc 撤钮', async ({ page }) => {
  let created = null;
  await setup(page, { boxes: BOXES, threads: [], onCreate: (b) => (created = b) });
  await goto(page);
  await ready(page);
  // 普通阅读态(不进评论模式)选字 → 消抖后浮钮出现在选区尾
  await selectQuote(page, false);
  const chip = page.locator('[data-pp-role="quote-chip"]');
  await expect(chip).toBeVisible();
  await page.keyboard.press('Escape'); // Esc 级联第一层:撤钮
  await expect(chip).toHaveCount(0);
  // 再选一次,点钮 → 同一条 quote 草稿管线
  await selectQuote(page, false);
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(draft(page)).toBeVisible();
  await expect(draft(page).locator('.pp-anno-dbubble-quote')).toContainText(QUOTE);
  await draft(page).locator('textarea').fill('模式外随选随评');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => created && created.quote).toBe(QUOTE);
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
});

test('草稿气泡压在既有 pin 之上(pin 曾嵌进输入框的回归)', async ({ page }) => {
  await setup(page, { boxes: BOXES, threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await expect(pin(page, 1)).toBeVisible();
  await page.locator('#t1').click({ modifiers: ['Alt'], position: { x: 150, y: 55 } }); // ⌥点 = 直接开元素草稿
  await expect(draft(page)).toBeVisible();
  const z = await page.evaluate(() => ({
    draft: +getComputedStyle(document.querySelector('[data-pp-role="draft"]')).zIndex,
    pinMax: 2147482650, // pin 聚焦态的 z(常态 2147482600)
  }));
  expect(z.draft).toBeGreaterThan(z.pinMax);
});

test('Esc 严格剥一层:先收草稿(留在模式),再退模式;回复框 Esc 只清输入不关 popover', async ({ page }) => {
  await setup(page, { boxes: BOXES, threads: [mkThread(1, '#t1')] });
  await goto(page);
  await ready(page);
  await dock(page).locator('[data-pp-act="collapse"]').click(); // 收托盘(用户环境:无托盘垫背)
  await page.keyboard.press('c');
  await page.locator('#t1').click({ position: { x: 150, y: 60 } });
  await expect(draft(page)).toBeVisible();
  await page.keyboard.press('Escape'); // 第一层:只收草稿(此前 bug:同键连托盘/模式一起剥)
  await expect(draft(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(/pp-anno-mode-on/);
  await page.keyboard.press('Escape'); // 第二层:退模式
  await expect(page.locator('html')).not.toHaveClass(/pp-anno-mode-on/);
  // 回复框 Esc:清输入、popover 保持展开
  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();
  const reply = focusedCard(page).locator('[data-pp-role="reply"]');
  await reply.fill('还没发出去的回复');
  await reply.press('Escape');
  await expect(focusedCard(page)).toBeVisible();
  await expect(reply).toHaveValue('');
});

test('模式内高亮条让路:被高亮的文字可直接打点(搬家);有字稿点 pin 抖动保护不吞稿', async ({ page }) => {
  const BOXES2 = [...BOXES, { id: 't2', left: 400, top: 60, text: '第二个盒子的内容' }];
  const t = mkThread(1, '#t1', { quote: QUOTE });
  await setup(page, { boxes: BOXES2, threads: [t] });
  await goto(page);
  await ready(page);
  await expect(page.locator('.pp-anno-hlrect').first()).toBeVisible();
  await page.keyboard.press('c');
  // 点在高亮条上(末行左端,避开悬在行尾上方的 pin):不再被 hlrect 截胡(此前 bug),直达底下元素打点
  // 进模式会级联重渲染高亮条(节点反复重建但几何稳定):轮询到拿到几何为止
  let hb = null;
  await expect
    .poll(async () => ((hb = await page.locator('.pp-anno-hlrect').last().boundingBox()), !!hb))
    .toBe(true);
  await page.mouse.click(hb.x + 10, hb.y + hb.height / 2);
  await expect(draft(page)).toBeVisible();
  await expect(page.locator('[data-pp-focused="1"]')).toHaveCount(0); // 没被截胡成聚焦线程
  // 空稿搬家到 t2,写半段字,再点 pin:抖动保留,不静默吞稿
  await page.locator('#t2').click({ position: { x: 150, y: 60 } });
  await expect(draft(page)).toBeVisible();
  await draft(page).locator('textarea').fill('写了一半');
  await pin(page, 1).click();
  await expect(draft(page)).toBeVisible();
  await expect(draft(page).locator('textarea')).toHaveValue('写了一半');
  await expect(page.locator('[data-pp-focused="1"]')).toHaveCount(0);
});
