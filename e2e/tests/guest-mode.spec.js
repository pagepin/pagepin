// @ts-check
// 分享会话访客（guest）模式：/api/viewer 带 ?handle=&slug= 探测，返回 guest:true 时 ——
//   - resolve / reopen / kind 修改控件一律不渲染（服务端对 guest PATCH 401），r 快捷键失效；
//   - 草稿卡 + 回复框带署名输入，发送时 author_name 进 POST body 并存 localStorage；
//   - author_sub 以 'guest:' 开头的评论在名字旁渲染低调 guest 徽标；
//   - guest 可删自己创建的线程（author_sub 匹配），别人的没有删除入口。
const { test, expect } = require('@playwright/test');
const {
  setup, goto, mkThread, NOW,
  pin, focusedCard, act, cards, draft, ready,
} = require('./_helpers');

const GUEST = { sub: 'guest:g-abc123', name: null, handle: null, guest: true };

/** 指定作者的单楼线程 */
function threadBy(n, selector, sub, name) {
  return mkThread(n, selector, {
    comments: [{ id: `c${n}`, author_sub: sub, author_name: name, text: `这是第 ${n} 条评论的内容`, created_at: NOW }],
  });
}

test('guest：viewer 探测带 handle/slug；resolve/reopen/kind 控件全部隐藏，r 快捷键无效', async ({ page }) => {
  const patches = [];
  await setup(page, {
    threads: [mkThread(1, '#t1'), mkThread(2, '#t2', { resolved: true })],
    viewer: GUEST,
    onPatch: (b) => patches.push(b),
  });
  const viewerReq = page.waitForRequest((r) => r.url().includes('/api/viewer'));
  await goto(page);
  await ready(page);
  // 探测请求带上了站点坐标（服务端据此判分享会话）
  const req = await viewerReq;
  expect(req.url()).toContain('handle=alice');
  expect(req.url()).toContain('slug=demo');

  // 折叠卡：无 resolve 按钮
  await expect(cards(page).first()).toBeVisible();
  await expect(page.locator('[data-pp-role="resolve"]')).toHaveCount(0);

  // 聚焦展开：仍无 resolve、无 kind chips（kind 修改会打 PATCH）
  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();
  await expect(focusedCard(page).locator('[data-pp-role="resolve"]')).toHaveCount(0);
  await expect(focusedCard(page).locator('[data-pp-kind]')).toHaveCount(0);

  // r 快捷键不发 PATCH
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  expect(patches).toHaveLength(0);

  // 已解决线程：切到「全部」聚焦，无 Reopen
  await page.locator('[data-pp-filter="all"]').click();
  await page.locator('[data-pp-role="card"][data-tid="thread-2"]').click();
  await expect(focusedCard(page)).toHaveAttribute('data-tid', 'thread-2');
  await expect(focusedCard(page).locator('[data-pp-role="reopen"]')).toHaveCount(0);
  await expect(focusedCard(page).locator('[data-pp-role="resolve"]')).toHaveCount(0);
});

test('guest：建线程草稿与回复框都有署名输入，POST body 携带 author_name 并本地暂存', async ({ page }) => {
  const creates = [];
  const replies = [];
  await setup(page, {
    threads: [mkThread(1, '#t1')],
    viewer: GUEST,
    onCreate: (b) => creates.push(b),
    onReply: (b) => replies.push(b),
  });
  await goto(page);
  await ready(page);

  // 评论模式点元素 → 草稿卡带署名输入
  await act(page, 'comment').click();
  await page.click('#t2');
  await expect(draft(page)).toBeVisible();
  const nameInp = draft(page).locator('[data-pp-role="guest-name"]');
  await expect(nameInp).toBeVisible();
  await nameInp.fill('访客小明');
  await draft(page).locator('textarea').fill('guest 的第一条评论');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].author_name).toBe('访客小明');
  expect(creates[0].text).toBe('guest 的第一条评论');
  expect(creates[0].selector).toBe('#t2');

  // 回复框：署名输入预填 localStorage 里的名字，发送时 author_name 进 body
  await pin(page, 1).click();
  await expect(focusedCard(page)).toBeVisible();
  const replyName = focusedCard(page).locator('[data-pp-role="guest-name"]');
  await expect(replyName).toBeVisible();
  await expect(replyName).toHaveValue('访客小明');
  const ta = focusedCard(page).locator('[data-pp-role="reply"]');
  await ta.fill('guest 的回复');
  await ta.press('Enter');
  await expect.poll(() => replies.length).toBe(1);
  expect(replies[0].author_name).toBe('访客小明');
  expect(replies[0].text).toBe('guest 的回复');
});

test('guest：名字留空也能发送（author_name 为 null，服务端落「访客」）', async ({ page }) => {
  const creates = [];
  await setup(page, { threads: [], viewer: GUEST, onCreate: (b) => creates.push(b) });
  await goto(page);
  await ready(page);
  await act(page, 'comment').click();
  await page.click('#t1');
  await expect(draft(page)).toBeVisible();
  await expect(draft(page).locator('[data-pp-role="guest-name"]')).toHaveValue('');
  await draft(page).locator('textarea').fill('匿名署名的评论');
  await draft(page).locator('[data-pp-role="send"]').click();
  await expect.poll(() => creates.length).toBe(1);
  expect(creates[0].author_name).toBe(null);
});

test('guest 作者徽标：author_sub 以 guest: 开头 → 名字旁渲染徽标；登录作者无徽标', async ({ page }) => {
  await setup(page, {
    threads: [
      threadBy(1, '#t1', 'guest:g-xyz', '路人甲'),
      mkThread(2, '#t2'), // author_sub = 'u-author'（登录用户）
    ],
  }); // 默认登录视角：徽标对所有人可见
  await goto(page);
  await ready(page);
  const guestCard = page.locator('[data-pp-role="card"][data-tid="thread-1"]');
  await expect(guestCard.locator('[data-pp-role="guest-badge"]')).toBeVisible();
  await expect(guestCard.locator('[data-pp-role="guest-badge"]')).toHaveText(/^(guest|访客)$/);
  await expect(page.locator('[data-pp-role="card"][data-tid="thread-2"] [data-pp-role="guest-badge"]')).toHaveCount(0);
  // 聚焦展开后评论楼层里同样有徽标
  await guestCard.click();
  await expect(focusedCard(page).locator('.pp-anno-msg [data-pp-role="guest-badge"]')).toHaveCount(1);
});

test('guest 可删自己创建的线程；别人的线程无删除入口', async ({ page }) => {
  await setup(page, {
    threads: [
      threadBy(1, '#t1', GUEST.sub, '路人甲'), // 自己的（author_sub 匹配 viewer.sub）
      mkThread(2, '#t2'),                      // 别人的
    ],
    viewer: GUEST,
  });
  await goto(page);
  await ready(page);
  // 自己的：有删除入口，两段式确认后卡片消失
  await pin(page, 1).click();
  const del = focusedCard(page).locator('[data-pp-role="delete"]');
  await expect(del).toBeVisible();
  await del.click(); // 一次点击 = 武装确认
  await del.click(); // 二次点击 = 真删
  await expect(page.locator('[data-pp-role="card"][data-tid="thread-1"]')).toHaveCount(0);
  // 别人的：无删除入口
  await page.locator('[data-pp-role="card"][data-tid="thread-2"]').click();
  await expect(focusedCard(page)).toHaveAttribute('data-tid', 'thread-2');
  await expect(focusedCard(page).locator('[data-pp-role="delete"]')).toHaveCount(0);
});
