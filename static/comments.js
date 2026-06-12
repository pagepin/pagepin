/* pagepin 评论层 —— 由数据平面 serve HTML 时注入（见 serving.ts）。
 *
 * 约束：
 *  - 宿主页面不可控：所有类名带 pp-anno 前缀、UI 挂独立容器、用户内容一律 textContent 渲染；
 *  - 身份来自 /api/viewer（pp_view 会话）：401 = 匿名访客，静默退出不留痕迹；
 *  - 锚点 = CSS 选择器 + 元素内相对偏移；"@page" = 整页评论（无 pin，仅侧边栏）；
 *    选择器失效（页面改版）降级为侧边栏「锚点丢失」项。
 *
 * 交互（v1.1）：
 *  - ⌥(Alt)+点击任意元素 = 免模式直接打点；C 切换连续评论模式；G 整页评论
 *  - j/k 在 pin 间跳转，Enter 打开当前线程，r 打开并聚焦回复
 *  - pin hover 预览；草稿未发时点外部不丢（抖动提示）；弹窗自动翻转避开视口边缘
 *  - 窗口聚焦 + 30s 轮询静默刷新；#pp-comment-<id> 深链直达
 */
(() => {
  'use strict';
  if (window.__ppAnnoLoaded) return;
  window.__ppAnnoLoaded = true;

  const script = document.currentScript;
  if (!script) return;
  const CFG = {
    handle: script.dataset.handle,
    slug: script.dataset.slug,
    path: script.dataset.path,
    version: script.dataset.version,
  };
  if (!CFG.handle || !CFG.slug || !CFG.path) return;

  const PAGE_SELECTOR = '@page';
  const PALETTE = ['#c2361b', '#1f4e8c', '#1a7f4e', '#8c4a1f', '#6b2d8c', '#b3791a', '#19767d'];
  const KIND_META = {
    copy: { label: '文案', color: '#1f4e8c' },
    style: { label: '样式', color: '#8c4a1f' },
    question: { label: '提问', color: '#6b2d8c' },
    bug: { label: 'Bug', color: '#c2361b' },
  };
  const state = {
    viewer: null,
    threads: [],
    mode: false,
    showResolved: false, // 页面上 pin 是否显示已解决（工具栏开关）
    sbStatus: 'open',    // 侧边栏状态筛选：open | resolved | all（与 pin 显示解耦）
    sbKinds: new Set(),  // 侧边栏类型筛选；空 = 不过滤
    openPopup: null,
    openThreadId: null,
    cursor: -1,          // j/k 键盘游标（指向当前可见 pin 序号-1）
    collapsed: false,
  };

  /* ---------------- API ---------------- */
  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { msg = (await res.json()).detail || msg; } catch (e) { /* not json */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const base = `/api/comments/${encodeURIComponent(CFG.handle)}/${encodeURIComponent(CFG.slug)}`;
  const fetchThreads = () => api(`${base}?path=${encodeURIComponent(CFG.path)}`);
  const createThread = (body) => api(base, { method: 'POST', body: JSON.stringify(body) });
  const addReply = (id, text) => api(`/api/comments/threads/${id}/replies`, { method: 'POST', body: JSON.stringify({ text }) });
  const patchThread = (id, resolved) => api(`/api/comments/threads/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) });
  const deleteThread = (id) => api(`/api/comments/threads/${id}`, { method: 'DELETE' });

  /* ---------------- 工具 ---------------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const colorOf = (name) => PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  const initialOf = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
  function fmtTime(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function cssPath(node) {
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    while (node && node !== document.body && node.parentNode) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); return parts.join(' > '); }
      let part = node.tagName.toLowerCase();
      const sibs = [...node.parentNode.children].filter((c) => c.tagName === node.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentNode;
    }
    return 'body > ' + parts.join(' > ');
  }
  function kindChip(kind, cls) {
    if (!kind || !KIND_META[kind]) return null;
    const c = el('span', cls || 'pp-anno-kind', KIND_META[kind].label);
    c.style.background = KIND_META[kind].color;
    return c;
  }
  function toast(msg) {
    const t = el('div', 'pp-anno-toast', msg);
    t.dataset.ppAnno = '1';
    root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ---------------- 样式 ---------------- */
  const STYLE = `
  /* 根容器必须脱流(absolute + 零高):宿主 body 若是 grid/flex,在流 div 会成为布局项,
     把页面内容挤跳。absolute 无定位祖先时以初始包含块为基准,layer 坐标系与从前一致 */
  .pp-anno-root{position:absolute;top:0;left:0;width:100%;height:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6;color:#211f1c}
  .pp-anno-root *{box-sizing:border-box;margin:0;padding:0}
  /* 十字光标：评论 UI 自身除外；弹窗打开期间（pp-anno-paused）整体暂停，输入时是正常光标 */
  .pp-anno-mode-on:not(.pp-anno-paused){cursor:crosshair}
  .pp-anno-mode-on:not(.pp-anno-paused) *:not(.pp-anno-root, .pp-anno-root *){cursor:crosshair!important}
  .pp-anno-hover-hint{outline:1.5px dashed rgba(194,54,27,.6)!important;outline-offset:2px!important}
  /* 绑定高亮（实线 = 已锁定）：写评论时的目标元素 / 读评论时的关联元素；虚线 = 候选扫描 */
  .pp-anno-bound{outline:2px solid rgba(194,54,27,.85)!important;outline-offset:2px!important;box-shadow:0 0 0 5px rgba(194,54,27,.12)!important}
  .pp-anno-toolbar{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:4px;background:#211f1c;border-radius:99px;padding:6px;box-shadow:0 8px 30px rgba(28,26,23,.35),0 2px 6px rgba(28,26,23,.2)}
  .pp-anno-toolbar button{border:none;background:transparent;color:#d8d2c6;font-size:13.5px;font-family:inherit;cursor:pointer;padding:8px 14px;border-radius:99px;display:flex;align-items:center;gap:7px;white-space:nowrap;transition:background .15s,color .15s}
  .pp-anno-toolbar button:hover{background:rgba(255,255,255,.08);color:#fff}
  .pp-anno-toolbar button.pp-anno-active{background:#c2361b;color:#fff}
  .pp-anno-count{background:rgba(255,255,255,.16);font-size:11.5px;padding:1px 7px;border-radius:99px}
  .pp-anno-active .pp-anno-count{background:rgba(0,0,0,.25)}
  .pp-anno-sep{width:1px;height:18px;background:rgba(255,255,255,.14);margin:0 2px}
  .pp-anno-bubble{position:fixed;bottom:26px;right:26px;z-index:2147483000;width:46px;height:46px;border-radius:50%;background:#211f1c;color:#f3efe7;display:grid;place-items:center;cursor:grab;font-size:15px;box-shadow:0 8px 30px rgba(28,26,23,.35);user-select:none;touch-action:none}
  .pp-anno-bubble:active{cursor:grabbing}
  .pp-anno-bubble .pp-anno-bn{position:absolute;top:-4px;right:-4px;background:#c2361b;color:#fff;font-size:10.5px;min-width:18px;height:18px;border-radius:99px;display:grid;place-items:center;padding:0 4px;font-weight:700}
  .pp-anno-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:2147482000}
  /* pin 必须高于弹窗（2147482500）：否则弹窗会盖住相邻 pin，点它命中的是弹窗而非 pin，弹窗不切换 */
  .pp-anno-pin{position:absolute;z-index:2147482600;width:32px;height:32px;border-radius:50% 50% 50% 4px;display:grid;place-items:center;color:#fff;font-size:13px;font-weight:700;cursor:pointer;transform:translate(-4px,-28px);border:2.5px solid #fff;box-shadow:0 3px 10px rgba(28,26,23,.35);user-select:none;transition:transform .15s,box-shadow .15s}
  .pp-anno-pin:hover{transform:translate(-4px,-28px) scale(1.15)}
  /* 框选区域:pin 之下、宿主内容之上;pointer-events 关掉,不挡页面交互(入口仍是 pin) */
  .pp-anno-region{position:absolute;z-index:2147481900;border:2px solid;border-radius:4px;pointer-events:none;box-sizing:border-box}
  .pp-anno-region.pp-anno-resolved{opacity:.35;filter:saturate(.3)}
  .pp-anno-region.pp-anno-current{box-shadow:0 0 0 3px rgba(194,54,27,.30)}
  .pp-anno-rubber{position:absolute;z-index:2147482700;border:2px dashed #c2361b;background:rgba(194,54,27,.08);border-radius:4px;pointer-events:none;box-sizing:border-box}
  .pp-anno-pin.pp-anno-resolved{opacity:.45;filter:saturate(.3)}
  .pp-anno-pin.pp-anno-current{box-shadow:0 0 0 4px rgba(194,54,27,.35),0 3px 10px rgba(28,26,23,.35)}
  .pp-anno-pin.pp-anno-pulse{animation:ppAnnoPinPop .45s cubic-bezier(.2,1.6,.4,1)}
  @keyframes ppAnnoPinPop{0%{transform:translate(-4px,-28px) scale(0)}100%{transform:translate(-4px,-28px) scale(1)}}
  .pp-anno-popup{position:absolute;z-index:2147482500;width:320px;background:#fffdf9;border-radius:12px;border:1px solid #e6dfd2;box-shadow:0 14px 44px rgba(28,26,23,.22),0 3px 10px rgba(28,26,23,.12);animation:ppAnnoPop .18s cubic-bezier(.2,1.4,.4,1)}
  @keyframes ppAnnoPop{from{opacity:0;transform:translateY(6px) scale(.97)}}
  .pp-anno-popup.pp-anno-shaking{animation:ppAnnoShake .3s}
  @keyframes ppAnnoShake{0%,100%{margin-left:0}25%{margin-left:-7px}75%{margin-left:7px}}
  .pp-anno-preview{position:absolute;z-index:2147482400;max-width:260px;background:#211f1c;color:#f3efe7;border-radius:10px;padding:10px 13px;font-size:12.5px;line-height:1.55;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;animation:ppAnnoPop .12s}
  .pp-anno-preview .pp-anno-pv-hd{display:flex;gap:6px;align-items:center;margin-bottom:3px;color:#b8b1a3;font-size:11.5px}
  .pp-anno-preview .pp-anno-pv-hd b{color:#f3efe7}
  .pp-anno-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #efe9dd;font-size:12.5px;color:#8a8378}
  .pp-anno-ops{margin-left:auto;display:flex;gap:2px}
  .pp-anno-ops button{border:none;background:none;cursor:pointer;font-size:12.5px;color:#8a8378;padding:3px 8px;border-radius:6px;font-family:inherit}
  .pp-anno-ops button:hover{background:#f1ece2;color:#211f1c}
  .pp-anno-ops .pp-anno-resolve{color:#1a7f4e}
  .pp-anno-msgs{max-height:260px;overflow-y:auto;padding:6px 0}
  .pp-anno-msg{display:flex;gap:10px;padding:9px 14px}
  .pp-anno-msg>div:last-child{flex:1;min-width:0}
  .pp-anno-ava{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700}
  .pp-anno-who{font-size:12.5px;font-weight:600}
  .pp-anno-when{font-size:11px;color:#aaa295;margin-left:6px;font-weight:400}
  .pp-anno-fl{float:right;font-size:10.5px;color:#cfc8ba;font-variant-numeric:tabular-nums}
  .pp-anno-txt{font-size:13.5px;line-height:1.55;margin-top:2px;word-break:break-word;white-space:pre-wrap}
  .pp-anno-ft{padding:10px 12px 12px;border-top:1px solid #efe9dd}
  .pp-anno-ft textarea{width:100%;border:1.5px solid #e0d9ca;border-radius:8px;padding:8px 10px;font-size:13.5px;font-family:inherit;resize:none;background:#fff;color:#211f1c;line-height:1.5}
  .pp-anno-ft textarea:focus{outline:none;border-color:#c2361b}
  .pp-anno-ft-row{display:flex;align-items:center;gap:8px;margin-top:8px}
  .pp-anno-hint{font-size:11px;color:#b3ab9d}
  .pp-anno-send{margin-left:auto;background:#c2361b;color:#fff;border:none;padding:6px 16px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .pp-anno-send:disabled{opacity:.4;cursor:default}
  .pp-anno-kinds{display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap}
  .pp-anno-kinds button{border:1px solid #e0d9ca;background:#fff;color:#8a8378;font-size:11.5px;padding:3px 11px;border-radius:99px;cursor:pointer;font-family:inherit}
  .pp-anno-kinds button.pp-anno-kon{color:#fff;border-color:transparent}
  .pp-anno-kind{display:inline-block;color:#fff;font-size:10.5px;padding:1px 8px;border-radius:99px;font-weight:600}
  .pp-anno-sidebar{position:fixed;top:0;right:0;bottom:0;width:320px;z-index:2147482800;background:#fffdf9;border-left:1px solid #e6dfd2;box-shadow:-10px 0 36px rgba(28,26,23,.12);transform:translateX(100%);transition:transform .22s cubic-bezier(.3,1,.4,1);display:flex;flex-direction:column}
  .pp-anno-sidebar.pp-anno-open{transform:translateX(0)}
  .pp-anno-sb-hd{padding:16px 18px 12px;border-bottom:1px solid #efe9dd;display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}
  .pp-anno-sb-sub{font-size:12px;color:#8a8378;font-weight:400}
  .pp-anno-sb-x{margin-left:auto;border:none;background:none;cursor:pointer;font-size:16px;color:#8a8378;padding:2px 6px}
  .pp-anno-sb-filters{padding:10px 12px 8px;border-bottom:1px solid #efe9dd}
  .pp-anno-seg{display:flex;background:#f1ece2;border-radius:8px;padding:2px;gap:2px}
  .pp-anno-seg button{flex:1;border:none;background:transparent;font-size:12px;color:#8a8378;padding:5px 4px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap}
  .pp-anno-seg button.pp-anno-segon{background:#fff;color:#211f1c;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .pp-anno-sb-list{flex:1;overflow-y:auto;padding:8px}
  .pp-anno-sb-group{font-size:11px;color:#aaa295;font-weight:700;letter-spacing:.08em;padding:10px 12px 4px}
  .pp-anno-sb-item{padding:11px 12px;border-radius:10px;cursor:pointer;margin-bottom:4px}
  .pp-anno-sb-item:hover{background:#f4efe5}
  .pp-anno-sb-top{display:flex;align-items:center;gap:8px}
  .pp-anno-sb-num{width:21px;height:21px;border-radius:50% 50% 50% 3px;flex:none;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:700}
  .pp-anno-sb-when{font-size:11px;color:#aaa295;margin-left:auto}
  .pp-anno-sb-link{border:none;background:none;cursor:pointer;font-size:11px;padding:2px 5px;border-radius:6px;opacity:0;transition:opacity .12s}
  .pp-anno-sb-item:hover .pp-anno-sb-link{opacity:.65}
  .pp-anno-sb-link:hover{opacity:1!important;background:#efe9dd}
  .pp-anno-sb-txt{font-size:13px;color:#5d574d;margin-top:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .pp-anno-sb-meta{font-size:11px;color:#aaa295;margin-top:4px;display:flex;gap:6px;align-items:center}
  .pp-anno-sb-item.pp-anno-resolved{opacity:.55}
  .pp-anno-sb-item.pp-anno-resolved .pp-anno-sb-txt{text-decoration:line-through}
  .pp-anno-sb-empty{text-align:center;color:#aaa295;font-size:13px;padding:48px 20px;line-height:2}
  .pp-anno-toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);z-index:2147483100;background:#211f1c;color:#f3efe7;font-size:13px;padding:9px 18px;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.3);animation:ppAnnoPop .2s}
  .pp-anno-chip{position:fixed;bottom:88px;right:26px;z-index:2147483100;background:#211f1c;color:#f3efe7;font-size:12.5px;padding:10px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3);cursor:pointer;max-width:300px;line-height:1.6;animation:ppAnnoPop .25s;transition:opacity .6s}
  .pp-anno-chip b{color:#ffb39e}
  .pp-anno-chip kbd{background:rgba(255,255,255,.14);border-radius:4px;padding:0 5px;font-family:inherit;font-size:11.5px}
  @media (max-width:640px){.pp-anno-sidebar{width:100%}.pp-anno-toolbar{bottom:14px;max-width:calc(100vw - 20px);overflow-x:auto}}
  `;

  /* ---------------- UI 骨架 ---------------- */
  let root, layer, toolbar, bubble, sidebar, btnMode, btnResolved, countBadge, bubbleBadge, sbFilters, sbList, sbSub;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    root = el('div', 'pp-anno-root');
    root.dataset.ppAnno = '1';
    layer = el('div', 'pp-anno-layer');

    toolbar = el('div', 'pp-anno-toolbar');
    btnMode = el('button', null);
    btnMode.append('💬 评论模式 ');
    countBadge = el('span', 'pp-anno-count', '0');
    btnMode.appendChild(countBadge);
    btnMode.title = '按 C 切换；⌥+点击可免模式直接评论';
    btnMode.onclick = () => setMode(!state.mode);
    const btnPage = el('button', null, '＋ 整页');
    btnPage.title = '对整个页面提意见（G）';
    btnPage.onclick = () => openComposerForPage();
    const btnList = el('button', null, '☰ 列表');
    btnList.onclick = () => {
      const open = sidebar.classList.toggle('pp-anno-open');
      if (open) renderSidebar(); // 打开时刷一次（平时高频重摆不重建侧栏）
    };
    btnResolved = el('button', null, '✓ 已解决');
    btnResolved.title = '显示/隐藏已解决的评论';
    btnResolved.onclick = () => {
      state.showResolved = !state.showResolved;
      btnResolved.style.color = state.showResolved ? '#7ee2a8' : '';
      render();
    };
    const btnFold = el('button', null, '—');
    btnFold.title = '收起（不挡页面）';
    btnFold.onclick = () => setCollapsed(true);
    toolbar.append(btnMode, btnPage, el('div', 'pp-anno-sep'), btnList, btnResolved, el('div', 'pp-anno-sep'), btnFold);

    bubble = el('div', 'pp-anno-bubble', '💬');
    bubble.dataset.ppAnno = '1';
    bubbleBadge = el('span', 'pp-anno-bn', '0');
    bubble.appendChild(bubbleBadge);
    bubble.title = '点击展开 · 按住拖动换位置';
    bubble.style.display = 'none';
    makeBubbleDraggable();

    sidebar = el('div', 'pp-anno-sidebar');
    const sbHd = el('div', 'pp-anno-sb-hd');
    sbHd.append('💬 本页评论 ');
    sbSub = el('span', 'pp-anno-sb-sub', '');
    const sbX = el('button', 'pp-anno-sb-x', '✕');
    sbX.onclick = () => sidebar.classList.remove('pp-anno-open');
    sbHd.append(sbSub, sbX);
    sbFilters = el('div', 'pp-anno-sb-filters');
    sbList = el('div', 'pp-anno-sb-list');
    sidebar.append(sbHd, sbFilters, sbList);

    root.append(layer, toolbar, bubble, sidebar);
    document.body.appendChild(root);

    try { setCollapsed(localStorage.getItem('pp-anno-collapsed') === '1'); } catch (e) { /* ignore */ }
  }

  /* 折叠气泡可拖动（盖住内容时挪开），位置记忆；位移 <5px 视为点击 = 展开 */
  function makeBubbleDraggable() {
    try {
      const saved = JSON.parse(localStorage.getItem('pp-anno-bubble-pos'));
      if (saved) placeBubble(saved.x, saved.y);
    } catch (e) { /* ignore */ }
    function placeBubble(x, y) {
      const m = 8, w = 46;
      x = Math.max(m, Math.min(x, document.documentElement.clientWidth - w - m));
      y = Math.max(m, Math.min(y, innerHeight - w - m));
      bubble.style.left = x + 'px';
      bubble.style.top = y + 'px';
      bubble.style.right = 'auto';
      bubble.style.bottom = 'auto';
      return { x, y };
    }
    bubble.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      const r = bubble.getBoundingClientRect();
      const ox = down.clientX - r.left, oy = down.clientY - r.top;
      let moved = false, last = null;
      const onMove = (e) => {
        if (!moved && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
        moved = true;
        last = placeBubble(e.clientX - ox, e.clientY - oy);
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        if (!moved) { setCollapsed(false); return; }
        if (last) { try { localStorage.setItem('pp-anno-bubble-pos', JSON.stringify(last)); } catch (e) { /* ignore */ } }
      };
      addEventListener('pointermove', onMove);
      addEventListener('pointerup', onUp);
    });
  }

  function setCollapsed(on) {
    state.collapsed = on;
    toolbar.style.display = on ? 'none' : '';
    bubble.style.display = on ? '' : 'none';
    if (on) setMode(false);
    try { localStorage.setItem('pp-anno-collapsed', on ? '1' : ''); } catch (e) { /* ignore */ }
  }

  /* ---------------- 锚点解析 ----------------
   * status: ok      正常（渲染 pin）
   *         clipped 元素被内部滚动容器裁出可视区（pin 隐藏，滚回来复现）
   *         changed 选择器命中但内容指纹不匹配——SPA 同构换数据（pin 隐藏，防错挂）
   *         lost    选择器找不到元素（页面改版）
   *         page    整页评论，无锚点 */
  const isPage = (t) => t.selector === PAGE_SELECTOR;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fingerprint = (node) => norm(node.textContent).slice(0, 80);

  function pointVisible(node, cx, cy) {
    // 锚点（视口坐标）是否落在所有 overflow 滚动祖先的可视区内
    let n = node.parentElement;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const r = n.getBoundingClientRect();
        if (cx < r.left - 1 || cx > r.right + 1 || cy < r.top - 1 || cy > r.bottom + 1) return false;
      }
      n = n.parentElement;
    }
    return true;
  }

  function resolveAnchor(t) {
    if (isPage(t)) return { status: 'page', el: null, pos: null };
    let node = null;
    try { node = document.querySelector(t.selector); } catch (e) { /* 非法选择器 */ }
    if (!node) return { status: 'lost', el: null, pos: null };
    if (t.anchor_text && fingerprint(node) !== t.anchor_text) return { status: 'changed', el: node, pos: null };
    const r = node.getBoundingClientRect();
    const vx = r.left + r.width * t.rx, vy = r.top + r.height * t.ry;
    const pos = { x: vx + scrollX, y: vy + scrollY };
    if (!pointVisible(node, vx, vy)) return { status: 'clipped', el: node, pos };
    return { status: 'ok', el: node, pos };
  }
  const anchorXY = (t) => { const a = resolveAnchor(t); return a.status === 'ok' || a.status === 'clipped' ? a.pos : null; };
  const visibleThreads = () => state.threads.filter((t) => state.showResolved || !t.resolved);
  const pinThreads = () => visibleThreads().filter((t) => resolveAnchor(t).status === 'ok');

  function render() {
    layer.querySelectorAll('.pp-anno-pin, .pp-anno-region').forEach((n) => n.remove());
    // 打开中的弹窗跟随锚点重定位（内部容器滚动时）
    if (state.openPopup && state.openPopup._getPos) {
      const pp = state.openPopup._getPos();
      if (pp) positionPopup(state.openPopup, pp.x, pp.y);
    }
    let n = 0;
    for (const t of visibleThreads()) {
      const a = resolveAnchor(t);
      if (a.status !== 'ok') { t._num = null; continue; }
      const pos = a.pos;
      n += 1;
      t._num = n;
      // 框选线程:先铺区域框(rx/ry 即框左上角,pin 钉在角上)
      if (t.rw != null && t.rh != null && a.el) {
        const r = a.el.getBoundingClientRect();
        const reg = el('div', 'pp-anno-region'
          + (t.resolved ? ' pp-anno-resolved' : '')
          + (state.openThreadId === t.id ? ' pp-anno-current' : ''));
        reg.dataset.ppAnno = '1';
        reg.dataset.tid = t.id;
        const color = colorOf(t.comments[0].author_name);
        reg.style.borderColor = color;
        reg.style.background = 'color-mix(in srgb, ' + color + ' 12%, transparent)';
        reg.style.left = (r.left + scrollX + r.width * t.rx) + 'px';
        reg.style.top = (r.top + scrollY + r.height * t.ry) + 'px';
        reg.style.width = (r.width * t.rw) + 'px';
        reg.style.height = (r.height * t.rh) + 'px';
        layer.appendChild(reg);
      }
      const pin = el('div', 'pp-anno-pin' + (t.resolved ? ' pp-anno-resolved' : ''), String(n));
      pin.dataset.ppAnno = '1';
      pin.dataset.tid = t.id;
      pin.style.left = pos.x + 'px';
      pin.style.top = pos.y + 'px';
      pin.style.background = colorOf(t.comments[0].author_name);
      pin.onclick = (e) => { e.stopPropagation(); removePreview(); openThread(t, pos); };
      pin.onmouseenter = () => showPreview(t, pos);
      pin.onmouseleave = removePreview;
      layer.appendChild(pin);
    }
    const open = state.threads.filter((t) => !t.resolved).length;
    countBadge.textContent = String(open);
    bubbleBadge.textContent = String(open);
    bubbleBadge.style.display = open ? '' : 'none';
    sbSub.textContent = `${open} 个待解决`;
    // 滚动/DOM 变化触发的高频重摆只动 pin；侧栏 DOM 仅在打开时跟着刷
    if (sidebar.classList.contains('pp-anno-open')) renderSidebar();
  }

  function renderSidebar() {
    // ── 筛选栏：状态分段（带计数）+ 类型 chip ──
    sbFilters.textContent = '';
    const nOpen = state.threads.filter((t) => !t.resolved).length;
    const nDone = state.threads.length - nOpen;
    const seg = el('div', 'pp-anno-seg');
    for (const [key, label, n] of [['open', '待解决', nOpen], ['resolved', '已解决', nDone], ['all', '全部', state.threads.length]]) {
      const b = el('button', state.sbStatus === key ? 'pp-anno-segon' : null, `${label} ${n}`);
      b.onclick = () => { state.sbStatus = key; renderSidebar(); };
      seg.appendChild(b);
    }
    sbFilters.appendChild(seg);
    const usedKinds = new Set(state.threads.map((t) => t.kind).filter(Boolean));
    if (usedKinds.size) {
      const row = el('div', 'pp-anno-kinds');
      row.style.margin = '8px 0 0';
      for (const [k, m] of Object.entries(KIND_META)) {
        if (!usedKinds.has(k)) continue;
        const b = el('button', null, m.label);
        if (state.sbKinds.has(k)) { b.classList.add('pp-anno-kon'); b.style.background = m.color; }
        b.onclick = () => {
          state.sbKinds.has(k) ? state.sbKinds.delete(k) : state.sbKinds.add(k);
          renderSidebar();
        };
        row.appendChild(b);
      }
      sbFilters.appendChild(row);
    }

    // ── 列表：按筛选条件过滤（与页面 pin 显隐解耦）──
    sbList.textContent = '';
    const items = state.threads.filter((t) =>
      (state.sbStatus === 'all' || (state.sbStatus === 'resolved') === t.resolved)
      && (!state.sbKinds.size || state.sbKinds.has(t.kind)));
    if (!items.length) {
      sbList.appendChild(el('div', 'pp-anno-sb-empty',
        state.threads.length ? '没有符合筛选条件的评论' : '还没有评论。⌥+点击页面任意元素即可发起，或点「＋ 整页」提整体意见。'));
      return;
    }
    const pages = items.filter(isPage);
    const pins = items.filter((t) => !isPage(t));
    if (pages.length) {
      sbList.appendChild(el('div', 'pp-anno-sb-group', '📄 整页意见'));
      pages.forEach((t) => sbList.appendChild(sbItem(t, '📄')));
    }
    if (pins.length) {
      if (pages.length) sbList.appendChild(el('div', 'pp-anno-sb-group', '📍 元素评论'));
      pins.forEach((t) => sbList.appendChild(sbItem(t)));
    }
  }

  function sbItem(t, icon) {
    const c0 = t.comments[0];
    const item = el('div', 'pp-anno-sb-item' + (t.resolved ? ' pp-anno-resolved' : ''));
    const top = el('div', 'pp-anno-sb-top');
    const num = el('span', 'pp-anno-sb-num', icon || (t._num != null ? String(t._num) : '•'));
    num.style.background = icon ? '#5d574d' : colorOf(c0.author_name);
    top.append(num, el('span', 'pp-anno-who', c0.author_name), el('span', 'pp-anno-sb-when', fmtTime(c0.created_at)));
    const link = el('button', 'pp-anno-sb-link', '🔗');
    link.title = '复制这条评论的链接';
    link.onclick = (e) => { e.stopPropagation(); copyThreadLink(t); }; // 不触发整行的跳转
    top.appendChild(link);
    const meta = el('div', 'pp-anno-sb-meta');
    const chip = kindChip(t.kind);
    if (chip) meta.appendChild(chip);
    const st = resolveAnchor(t).status;
    const note = st === 'lost' ? ' · ⚠️ 原锚点丢失'
      : st === 'changed' ? ' · ⚠️ 页面内容已变化'
      : st === 'clipped' ? ' · 滚动后可见' : '';
    meta.appendChild(el('span', null,
      `共 ${t.comments.length} 条` + (t.resolved ? ' · 已解决' : '') + note));
    const item2 = el('div', 'pp-anno-sb-txt', c0.text);
    item.append(top, item2, meta);
    item.onclick = () => focusThread(t);
    return item;
  }

  function focusThread(t) {
    const a = resolveAnchor(t);
    if (!a.el || a.status === 'changed') { openThread(t, centerPos()); return; }
    // scrollIntoView 能连带滚动内部容器（窗口 scrollTo 做不到）
    a.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const b = resolveAnchor(t);
      openThread(t, b.pos || centerPos());
    }, 420);
  }
  const centerPos = () => ({ x: scrollX + document.documentElement.clientWidth / 2 - 160, y: scrollY + innerHeight / 3 });

  /* ---------------- 元素绑定高亮 ----------------
   * 实线框标出评论关联的元素：写评论时 = 被点的目标；读评论（hover 预览 / 打开线程）= 锚点元素。
   * popupTarget 记住弹窗的绑定，预览移开后恢复它。 */
  let popupTarget = null;
  function setBound(node) {
    document.querySelectorAll('.pp-anno-bound').forEach((n) => n.classList.remove('pp-anno-bound'));
    if (node && node !== document.body && !node.closest('[data-pp-anno]')) node.classList.add('pp-anno-bound');
  }
  function threadEl(t) {
    if (isPage(t)) return null;
    try { return document.querySelector(t.selector); } catch (e) { return null; }
  }

  /* ---------------- hover 预览 ---------------- */
  let previewEl = null;
  function showPreview(t, pos) {
    if (state.openThreadId === t.id) return;
    removePreview();
    const p = el('div', 'pp-anno-preview');
    p.dataset.ppAnno = '1';
    const hd = el('div', 'pp-anno-pv-hd');
    const b = el('b', null, t.comments[0].author_name);
    hd.append(b, el('span', null, fmtTime(t.comments[0].created_at)));
    const chip = kindChip(t.kind);
    if (chip) hd.appendChild(chip);
    p.appendChild(hd);
    const txt = t.comments[0].text;
    p.appendChild(el('div', null, txt.length > 90 ? txt.slice(0, 90) + '…' : txt));
    if (t.comments.length > 1) {
      const more = el('div', null, `↳ ${t.comments.length - 1} 条回复`);
      more.style.cssText = 'margin-top:4px;color:#b8b1a3;font-size:11.5px';
      p.appendChild(more);
    }
    layer.appendChild(p);
    const w = p.offsetWidth, h = p.offsetHeight;
    p.style.left = Math.max(scrollX + 8, Math.min(pos.x - w / 2, scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
    // 默认在 pin 上方；贴近视口顶放不下时翻到 pin 下方
    let top = pos.y - h - 40;
    if (top < scrollY + 8) top = pos.y + 16;
    p.style.top = top + 'px';
    previewEl = p;
    setBound(threadEl(t));
  }
  function removePreview() {
    if (previewEl) { previewEl.remove(); previewEl = null; }
    setBound(popupTarget); // 移开预览后恢复弹窗的绑定（无弹窗则清除）
  }

  /* ---------------- 弹窗 ---------------- */
  function popupHasDraft() {
    if (!state.openPopup) return false;
    const ta = state.openPopup.querySelector('textarea');
    return !!(ta && ta.value.trim());
  }
  let lastShakeHint = 0;
  function shakePopup() {
    const p = state.openPopup;
    if (!p) return;
    p.classList.remove('pp-anno-shaking');
    void p.offsetWidth; // 重启动画
    p.classList.add('pp-anno-shaking');
    p.querySelector('textarea')?.focus();
    if (Date.now() - lastShakeHint > 2500) { // 光抖不说话看不懂拦截原因；提示限频防刷屏
      lastShakeHint = Date.now();
      toast('有未发送的内容：发布它，或按 Esc 放弃');
    }
  }
  /* 线程回复草稿随切换暂存（threadId → 文本），重开该线程时回填；
   * Esc/发布/删除等强制关闭 = 明确放弃，清掉暂存。
   * 新评论（composer）没有稳定 id 可挂靠，仍走抖动拦截。 */
  const draftStash = new Map();

  function closePopup(force) {
    if (!state.openPopup) return true;
    const ta = state.openPopup.querySelector('textarea');
    const draft = ta ? ta.value.trim() : '';
    if (state.openThreadId) {
      if (force || !draft) draftStash.delete(state.openThreadId);
      else draftStash.set(state.openThreadId, ta.value); // 切走自动暂存，不拦截
    } else if (!force && draft) {
      shakePopup();
      return false; // composer 草稿保护
    }
    if (state.openPopup._cleanup) state.openPopup._cleanup();
    state.openPopup.remove();
    state.openPopup = null;
    state.openThreadId = null;
    popupTarget = null;
    setBound(null);
    layer.querySelectorAll('.pp-anno-region.pp-anno-current').forEach((n) => n.classList.remove('pp-anno-current'));
    document.documentElement.classList.remove('pp-anno-paused');
    return true;
  }
  function popupShell(x, y) {
    if (!closePopup()) return null;
    removePreview();
    const p = el('div', 'pp-anno-popup');
    p.dataset.ppAnno = '1';
    layer.appendChild(p);
    state.openPopup = p;
    document.documentElement.classList.add('pp-anno-paused');
    if (hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
    // 先挂载再定位：测量实际尺寸后夹紧/翻转
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.visibility = 'hidden';
    requestAnimationFrame(() => { positionPopup(p, x, y); p.style.visibility = ''; });
    return p;
  }
  function positionPopup(p, x, y) {
    // 水平夹紧视口；垂直超出底部时翻到锚点上方
    const w = p.offsetWidth || 320, h = p.offsetHeight || 200;
    const vw = document.documentElement.clientWidth;
    p.style.left = Math.max(scrollX + 8, Math.min(x + 16, scrollX + vw - w - 16)) + 'px';
    let top = y + 12;
    if (top + h > scrollY + innerHeight - 12) top = y - h - 12;
    p.style.top = Math.max(scrollY + 8, top) + 'px';
  }
  function footer(p, placeholder, onSubmit, withKinds) {
    const ft = el('div', 'pp-anno-ft');
    let kind = null;
    if (withKinds) {
      const row = el('div', 'pp-anno-kinds');
      for (const [k, m] of Object.entries(KIND_META)) {
        const b = el('button', null, m.label);
        b.onclick = () => {
          kind = kind === k ? null : k;
          row.querySelectorAll('button').forEach((x) => { x.classList.remove('pp-anno-kon'); x.style.background = ''; });
          if (kind) { b.classList.add('pp-anno-kon'); b.style.background = m.color; }
        };
        row.appendChild(b);
      }
      ft.appendChild(row);
    }
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = placeholder;
    const row = el('div', 'pp-anno-ft-row');
    const send = el('button', 'pp-anno-send', '发布');
    row.append(el('span', 'pp-anno-hint', 'Enter 发送 · Shift+Enter 换行 · Esc 放弃'), send);
    ft.append(ta, row);
    p.appendChild(ft);
    const submit = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      send.disabled = true;
      try { await onSubmit(text, kind); }
      catch (e) { toast(e.message || '操作失败'); send.disabled = false; return; }
    };
    send.onclick = submit;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } };
    return ta;
  }

  function openComposer(x, y, selector, rx, ry, box) {
    const p = popupShell(x, y);
    if (!p) return;
    if (selector !== PAGE_SELECTOR) {
      try { popupTarget = document.querySelector(selector); } catch (e) { popupTarget = null; }
      setBound(popupTarget);
      // 跟随点必须 = 初始弹出点:框选时弹窗开在框右下角,若跟随 rx/ry(左上角),
      // focus 引起的微滚一触发重摆,弹窗就会被吸去左上角(实测「点输入框弹窗移位」)
      const fx = box ? Math.min(1, rx + box.rw) : rx;
      const fy = box ? Math.min(1, ry + box.rh) : ry;
      p._getPos = () => {
        let node = null;
        try { node = document.querySelector(selector); } catch (e) { /* ignore */ }
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: r.left + scrollX + r.width * fx, y: r.top + scrollY + r.height * fy };
      };
    }
    if (box && popupTarget) {
      // 撰写期间保留虚线框预览,关闭/发布时随 _cleanup 撤掉
      const r = popupTarget.getBoundingClientRect();
      const reg = el('div', 'pp-anno-rubber');
      reg.dataset.ppAnno = '1';
      reg.style.left = (r.left + scrollX + r.width * rx) + 'px';
      reg.style.top = (r.top + scrollY + r.height * ry) + 'px';
      reg.style.width = (r.width * box.rw) + 'px';
      reg.style.height = (r.height * box.rh) + 'px';
      layer.appendChild(reg);
      p._cleanup = () => reg.remove();
    }
    const hd = el('div', 'pp-anno-hd',
      selector === PAGE_SELECTOR ? '📄 整页意见' : box ? '⬚ 区域评论' : '📍 新评论');
    const ops = el('div', 'pp-anno-ops');
    const xBtn = el('button', null, '✕');
    xBtn.onclick = () => closePopup(true);
    ops.appendChild(xBtn);
    hd.appendChild(ops);
    p.appendChild(hd);
    const ta = footer(p, selector === PAGE_SELECTOR ? '对这个页面整体说点什么…' : '说点什么…', async (text, kind) => {
      // 内容指纹：发布时快照目标元素文本，SPA 换数据后据此判定「内容已变化」
      const anchor_text = popupTarget && selector !== PAGE_SELECTOR ? fingerprint(popupTarget) || null : null;
      const t = await createThread({
        path: CFG.path, selector, rx, ry,
        rw: box ? box.rw : null, rh: box ? box.rh : null,
        kind, anchor_text, text,
      });
      state.threads.push(t);
      closePopup(true);
      render();
      const pin = layer.querySelector(`.pp-anno-pin[data-tid="${t.id}"]`);
      if (pin) pin.classList.add('pp-anno-pulse');
      else toast('已记录整页意见 ✓');
    }, true);
    ta.focus();
  }
  const openComposerForPage = () => openComposer(centerPos().x, centerPos().y, PAGE_SELECTOR, 0, 0);

  /** 复制评论深链（弹窗 🔗 与侧栏行共用）。http 等非安全上下文没有
   * clipboard API，退回 execCommand。 */
  async function copyThreadLink(t) {
    const url = location.href.split('#')[0] + '#pp-comment-' + t.id;
    try {
      await navigator.clipboard.writeText(url);
    } catch (e) {
      const tmp = el('textarea');
      tmp.dataset.ppAnno = '1';
      tmp.value = url;
      tmp.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(tmp);
      tmp.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      tmp.remove();
    }
    toast('链接已复制，打开即定位到这条评论');
  }

  function openThread(t, pos, focusReply) {
    const p = popupShell(pos.x, pos.y);
    if (!p) return;
    state.openThreadId = t.id;
    layer.querySelectorAll('.pp-anno-region').forEach((n) =>
      n.classList.toggle('pp-anno-current', n.dataset.tid === t.id));
    popupTarget = threadEl(t);
    setBound(popupTarget);
    p._getPos = () => resolveAnchor(t).pos;
    const hd = el('div', 'pp-anno-hd');
    hd.appendChild(el('span', null, isPage(t) ? '📄 整页意见' : `#${t._num != null ? t._num : '•'}`));
    const chip = kindChip(t.kind);
    if (chip) hd.appendChild(chip);
    hd.appendChild(el('span', null, `${t.comments.length} 条`));
    const ops = el('div', 'pp-anno-ops');
    const linkBtn = el('button', null, '🔗');
    linkBtn.title = '复制这条评论的链接（打开即定位）';
    linkBtn.onclick = () => copyThreadLink(t);
    ops.appendChild(linkBtn);
    const resolveBtn = el('button', 'pp-anno-resolve', t.resolved ? '↩ 重新打开' : '✓ 解决');
    resolveBtn.onclick = async () => {
      try {
        const updated = await patchThread(t.id, !t.resolved);
        Object.assign(t, updated);
        closePopup(true);
        render();
      } catch (e) { toast(e.message || '操作失败'); }
    };
    ops.appendChild(resolveBtn);
    const mine = state.viewer && t.comments[0].author_sub === state.viewer.sub;
    if (mine) {
      // 两步确认替代原生 confirm：第一次点变红色「确认删除？」，3 秒不点自动还原
      const delBtn = el('button', null, '删除');
      let disarm = null;
      delBtn.onclick = async () => {
        if (!delBtn.dataset.armed) {
          delBtn.dataset.armed = '1';
          delBtn.textContent = '确认删除？';
          delBtn.style.cssText = 'color:#fff;background:#c2361b';
          disarm = setTimeout(() => {
            delete delBtn.dataset.armed;
            delBtn.textContent = '删除';
            delBtn.style.cssText = '';
          }, 3000);
          return;
        }
        clearTimeout(disarm);
        try {
          await deleteThread(t.id);
          state.threads = state.threads.filter((x) => x.id !== t.id);
          closePopup(true);
          render();
        } catch (e) { toast(e.message || '删除失败'); }
      };
      ops.appendChild(delBtn);
    }
    const xBtn = el('button', null, '✕');
    xBtn.onclick = () => closePopup(); // 有草稿会抖动拦截
    ops.appendChild(xBtn);
    hd.appendChild(ops);

    const msgs = el('div', 'pp-anno-msgs');
    t.comments.forEach((c, i) => {
      const m = el('div', 'pp-anno-msg');
      const ava = el('div', 'pp-anno-ava', initialOf(c.author_name));
      ava.style.background = colorOf(c.author_name);
      const right = el('div');
      const line = el('div');
      line.append(el('span', 'pp-anno-who', c.author_name), el('span', 'pp-anno-when', fmtTime(c.created_at)));
      if (t.comments.length > 3) line.append(el('span', 'pp-anno-fl', String(i + 1))); // 楼层号：长线程才显示
      right.append(line, el('div', 'pp-anno-txt', c.text));
      m.append(ava, right);
      msgs.appendChild(m);
    });
    p.append(hd, msgs);
    const ta = footer(p, '回复…', async (text) => {
      const reply = await addReply(t.id, text);
      t.comments.push(reply);
      ta.value = ''; // 清草稿（closePopup 会按内容决定暂存与否）
      draftStash.delete(t.id);
      render();
      openThread(t, pos, true); // 焦点回到回复框，方便连续回复
    });
    const stashed = draftStash.get(t.id);
    if (stashed) ta.value = stashed; // 回填上次切走时的草稿
    msgs.scrollTop = 1e5;
    // 弹窗此刻还是 visibility:hidden（popupShell 下一帧才显示），隐藏元素 focus() 会被忽略——
    // 排在显示那一帧之后再聚焦
    if (focusReply) requestAnimationFrame(() => requestAnimationFrame(() => ta.focus()));
  }

  /* ---------------- 评论模式 / 免模式打点 ---------------- */
  let hoverHint = null;
  function setMode(on) {
    state.mode = on;
    document.documentElement.classList.toggle('pp-anno-mode-on', on);
    btnMode.classList.toggle('pp-anno-active', on);
    if (!on && hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
  }

  document.addEventListener('mouseover', (e) => {
    if (!state.mode || state.openPopup) return; // 弹窗打开期间不再高亮背后元素
    if (hoverHint) hoverHint.classList.remove('pp-anno-hover-hint');
    hoverHint = e.target.closest('[data-pp-anno]') ? null : e.target;
    if (hoverHint && hoverHint !== document.body) hoverHint.classList.add('pp-anno-hover-hint');
  }, true);

  /* 评论模式下屏蔽浏览器原生拖拽/划选:十字光标的语义是「点哪评哪」,
   * 但按住稍一移动,图片会触发原生拖图幽灵、文本会开始划选,打点被截胡。
   * 与十字光标同一套豁免:弹窗打开(paused)期间不拦,评论层自身 UI 不拦。 */
  const modeArmed = (e) =>
    state.mode &&
    !document.documentElement.classList.contains('pp-anno-paused') &&
    !(e.target.closest && e.target.closest('[data-pp-anno]'));
  document.addEventListener('dragstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);
  document.addEventListener('selectstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);

  /* ---------------- 图片框选(bbox 评论) ----------------
   * 评论模式下在 <img> 上按住拖动 = 圈出一块区域评论;轻点(位移 < 5px)仍走点打点。
   * rx/ry 存框左上角、rw/rh 存相对宽高(0~1),随图片缩放自适应。 */
  let suppressNextClick = false; // 框选松手派生的 click 要吞掉,防止又开一个点评论
  document.addEventListener('mousedown', (down) => {
    if (!state.mode || state.openPopup || down.button !== 0) return;
    const img = down.target;
    if (!(img instanceof HTMLImageElement) || img.closest('[data-pp-anno]')) return;
    const r0 = img.getBoundingClientRect();
    if (!r0.width || !r0.height) return;
    const sx = down.clientX, sy = down.clientY;
    let rubber = null;
    const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const geom = (e) => {
      const x1 = cl(Math.min(sx, e.clientX), r0.left, r0.right);
      const x2 = cl(Math.max(sx, e.clientX), r0.left, r0.right);
      const y1 = cl(Math.min(sy, e.clientY), r0.top, r0.bottom);
      const y2 = cl(Math.max(sy, e.clientY), r0.top, r0.bottom);
      return { x1, y1, w: x2 - x1, h: y2 - y1 };
    };
    const onMove = (e) => {
      if (!rubber) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
        rubber = el('div', 'pp-anno-rubber');
        rubber.dataset.ppAnno = '1';
        layer.appendChild(rubber);
      }
      const g = geom(e);
      rubber.style.left = (g.x1 + scrollX) + 'px';
      rubber.style.top = (g.y1 + scrollY) + 'px';
      rubber.style.width = g.w + 'px';
      rubber.style.height = g.h + 'px';
    };
    const onUp = (e) => {
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
      if (!rubber) return;               // 轻点:不拦,后续 click 走点打点
      rubber.remove();
      suppressNextClick = true;
      const g = geom(e);
      if (g.w < 8 || g.h < 8) return;    // 框太小视为误触,什么都不发生
      openComposer(g.x1 + g.w + scrollX, g.y1 + g.h + scrollY, cssPath(img),
        cl((g.x1 - r0.left) / r0.width, 0, 1), cl((g.y1 - r0.top) / r0.height, 0, 1),
        { rw: Math.min(1, g.w / r0.width), rh: Math.min(1, g.h / r0.height) });
    };
    addEventListener('mousemove', onMove);
    addEventListener('mouseup', onUp);
  }, true);

  function composeAt(e) {
    const node = e.target;
    const r = node.getBoundingClientRect();
    const rx = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const ry = r.height ? (e.clientY - r.top) / r.height : 0.5;
    openComposer(e.pageX, e.pageY, cssPath(node),
      Math.min(1, Math.max(0, rx)), Math.min(1, Math.max(0, ry)));
  }

  document.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-pp-anno]')) return;
    if (state.mode || e.altKey) {            // 评论模式，或任意时刻 ⌥+点击
      e.preventDefault();
      e.stopPropagation();
      // 两步式:已有弹窗开着时,这次点击只负责收掉它(空稿直接关、有稿抖动拦截),
      // 不在新位置立刻再开 —— 否则「一路点一路冒框」很乱。⌥+点击是明确意图,仍直接弹。
      if (state.openPopup && !e.altKey) {
        closePopup();
        return;
      }
      composeAt(e);
      return;
    }
    closePopup();                            // 模式外点空白：关弹窗（草稿保护内置）
  }, true);

  /* ---------------- 键盘 ---------------- */
  function jumpPin(delta) {
    const pins = pinThreads();
    if (!pins.length) return;
    state.cursor = (state.cursor + delta + pins.length) % pins.length;
    const t = pins[state.cursor];
    layer.querySelectorAll('.pp-anno-pin, .pp-anno-region').forEach((p) => p.classList.toggle('pp-anno-current', p.dataset.tid === t.id));
    const pos = anchorXY(t);
    if (pos) scrollTo({ top: pos.y - innerHeight / 2, behavior: 'smooth' });
  }
  function openCursor(focusReply) {
    const pins = pinThreads();
    if (state.cursor < 0 || state.cursor >= pins.length) return;
    const t = pins[state.cursor];
    const pos = anchorXY(t);
    if (pos) openThread(t, pos, focusReply);
  }

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')
      || (document.activeElement && document.activeElement.isContentEditable);
    if (e.key === 'Escape') {
      if (closePopup(true)) {
        setMode(false);
        layer.querySelectorAll('.pp-anno-current').forEach((p) => p.classList.remove('pp-anno-current'));
        state.cursor = -1;
      }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') setMode(!state.mode);
    else if (e.key === 'g' || e.key === 'G') openComposerForPage();
    else if (e.key === 'j' || e.key === 'J') jumpPin(1);
    else if (e.key === 'k' || e.key === 'K') jumpPin(-1);
    else if (e.key === 'Enter' && state.cursor >= 0 && !state.openPopup) { e.preventDefault(); openCursor(false); }
    else if (e.key === 'r' || e.key === 'R') { if (state.cursor >= 0) { e.preventDefault(); openCursor(true); } }
  });

  addEventListener('resize', () => render());
  addEventListener('load', () => render()); // 图片/字体加载完布局会变，pin 重摆

  /* ---------------- 跟随重摆：内部容器滚动 + DOM 变化 ----------------
   * pin 用文档坐标，整页滚动天然跟随；内部 overflow 容器滚动则必须重摆。
   * scroll 不冒泡但可捕获；rAF 节流。 */
  let rafPending = false;
  function scheduleRender() {
    if (!layer || rafPending) return; // UI 未初始化（viewer 401 等）不渲染
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }
  document.addEventListener('scroll', (e) => {
    if (e.target !== document) scheduleRender(); // 整页滚动无需重摆
  }, true);
  // SPA 换内容 / 动态加载：DOM 变了就重摆（忽略评论层自身的变更，防自激）
  new MutationObserver((muts) => {
    for (const m of muts) {
      const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (n && n.closest && n.closest('[data-pp-anno]')) continue;
      if (m.type === 'attributes' && m.attributeName === 'class') {
        // 评论层给宿主元素加/删的高亮类（绑定/悬停虚线）不算页面变化——
        // 否则 hover pin → 加类 → 重摆销毁重建 pin → 悬停事件错乱（自激）
        const before = (m.oldValue || '').split(/\s+/).filter(Boolean);
        const after = [...m.target.classList];
        const diff = before.filter((x) => !after.includes(x))
          .concat(after.filter((x) => !before.includes(x)));
        if (diff.length && diff.every((cls) => cls.startsWith('pp-anno-'))) continue;
      }
      scheduleRender();
      return;
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    // style/class 等影响布局的属性变化也要重摆（rAF 已节流；高频动画页可接受）
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['style', 'class', 'src', 'width', 'height', 'open', 'hidden'],
  });

  /* ---------------- 静默刷新 ---------------- */
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (state.openPopup) return;             // 正在看/写评论时不打断
    try {
      const data = await fetchThreads();
      const before = JSON.stringify(state.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      const after = JSON.stringify(data.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      if (before !== after) { state.threads = data.threads; render(); }
    } catch (e) { /* 静默：网络抖动/会话过期都不打扰 */ }
  }
  setInterval(refresh, 30000);
  addEventListener('focus', refresh);

  /* ---------------- 宿主页就地换路径（图片查看器壳的 lightbox 切换） ----------------
   * 壳在切换前派发 cancelable 的 pagepin:navigate（detail.path = 新站内路径）：
   * composer 有未发草稿 → preventDefault 阻断切换（closePopup 已抖动提示）；
   * 否则换路径清空线程重拉，后续新建评论自动落在新路径上。 */
  addEventListener('pagepin:navigate', (e) => {
    const next = e && e.detail && e.detail.path;
    if (!next || next === CFG.path) return;
    if (!closePopup()) { e.preventDefault(); return; }
    CFG.path = next;
    state.threads = [];
    state.cursor = -1;
    render();
    fetchThreads()
      .then((data) => { state.threads = data.threads; render(); })
      .catch(() => { /* 静默：30s 轮询/聚焦刷新会补 */ });
  });

  /* ---------------- 首次引导（非阻断 chip） ---------------- */
  function maybeChip() {
    let seen = null;
    try { seen = localStorage.getItem('pp-anno-coached2'); } catch (e) { /* ignore */ }
    if (seen) return;
    try { localStorage.setItem('pp-anno-coached2', '1'); } catch (e) { /* ignore */ }
    const chip = el('div', 'pp-anno-chip');
    chip.dataset.ppAnno = '1';
    chip.innerHTML = ''; // 全静态内容，下面用 DOM 拼
    const l1 = el('div');
    const b = el('b', null, '这个页面可以直接评论');
    l1.append('💬 ', b);
    const l2 = el('div');
    const kbd = el('kbd', null, '⌥ + 点击');
    l2.append(kbd, ' 任意元素试试，意见会钉在那里');
    chip.append(l1, l2);
    chip.onclick = () => chip.remove();
    root.appendChild(chip);
    setTimeout(() => { chip.style.opacity = '0'; setTimeout(() => chip.remove(), 700); }, 8000);
  }

  /* ---------------- 深链 #pp-comment-<id> ---------------- */
  function maybeDeepLink() {
    // id 形态宽匹配（UUID 等）；原 24 位 hex 正则是内部版 ObjectId 的遗留，UUID 永远匹配不上
    const m = location.hash.match(/^#pp-comment-([\w-]{8,})$/);
    if (!m) return;
    const t = state.threads.find((x) => x.id === m[1]);
    if (!t) return;
    if (t.resolved && !state.showResolved) { state.showResolved = true; render(); }
    setTimeout(() => focusThread(t), 300);
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    try {
      state.viewer = await api('/api/viewer');
    } catch (e) {
      return; // 匿名访客：不渲染任何 UI
    }
    buildUI();
    try {
      const data = await fetchThreads();
      state.threads = data.threads;
    } catch (e) {
      if (e.status === 403) { root.remove(); return; } // 站点已关评论
      toast('评论加载失败：' + (e.message || ''));
    }
    render();
    maybeDeepLink();
    maybeChip();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
})();
