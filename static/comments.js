/* pagepin 评论层 —— 由数据平面 serve HTML 时注入（见 serving.ts）。
 *
 * 约束：
 *  - 宿主页面不可控：所有类名带 pp-anno 前缀、UI 挂独立容器、用户内容一律 textContent 渲染；
 *  - 身份来自 /api/viewer（pp_view 会话）：401 = 匿名访客，静默退出不留痕迹；
 *  - 锚点 = CSS 选择器 + 元素内相对偏移；"@page" = 整页评论（无 pin，仅列表）；
 *    选择器失效（页面改版）降级为列表「锚点丢失」项。
 *
 * 交互模型（v2，单命令条 + Review Walk）：
 *  - 一根底部命令条是唯一全局 chrome，按状态变形：resting / comment / walk / caught-up
 *  - 读与改都发生在 pin 处的 at-pin 弹层；Review Walk 按文档序步进未解决线程
 *  - ⌘/⌥+点击元素 / 在图片上拖框 = 打点；C 进评论模式；点 pin = 从该处进入 Walk
 *  - j/k 步进、r 解决并前进、Esc 退出；resolve-and-advance（Gmail archive-and-next）
 *  - #pp-comment-<id> 深链直达并进入 Walk；窗口聚焦 + 30s 轮询静默刷新
 *
 * e2e 钩子：稳定的 data-pp-role / data-pp-* 属性（与展示/i18n 解耦），见各处标注。
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
  // 四种 kind = 评审色彩地图（agent 从 JSON 读 kind 路由修复）
  const KIND = {
    copy: { label: 'Copy', color: '#2f6fb0', tint: '#e8f0f9', ink: '#1f4f86' },
    style: { label: 'Style', color: '#c07a16', tint: '#faf0db', ink: '#8a560b' },
    question: { label: 'Question', color: '#7c4bc0', tint: '#f0eafb', ink: '#5b3596' },
    bug: { label: 'Bug', color: '#c2361b', tint: '#fbe7e3', ink: '#94260f' },
  };
  const KIND_KEYS = ['copy', 'style', 'question', 'bug'];
  const NO_KIND = '#3a424b';
  const RESOLVED_COLOR = '#aeb4ba';
  const AVA = ['#2f6fb0', '#0f7c72', '#7c4bc0', '#c07a16', '#b14a42'];

  const state = {
    viewer: null,
    threads: [],
    mode: 'rest', // rest | comment | walk
    filter: 'open', // open | all（页面上 pin：是否显示已解决）
    walk: { curId: null, entryTop: false, resolvedThisPass: 0 },
    listOpen: false,
    openPopup: null,
    openThreadId: null,
  };

  /* ---------------- API（保留） ---------------- */
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

  /* ---------------- 工具（保留 + 英文化） ---------------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(d, w) {
    const s = `<svg width="${w || 15}" height="${w || 15}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const span = document.createElement('span');
    span.className = 'pp-anno-ic';
    span.innerHTML = s;
    return span;
  }
  const ICON = {
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
  };
  const avatarColor = (name) => AVA[[...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length];
  const initialOf = (name) => (name || '?').trim().slice(0, 1).toUpperCase();
  function fmtTime(iso) {
    const d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 14) return Math.floor(diff / 86400) + 'd ago';
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  // 线程当前 kind 的色（无 kind → 中性 slate；已解决 → 灰）
  const kindColor = (t) => (t.resolved ? RESOLVED_COLOR : (t.kind && KIND[t.kind] ? KIND[t.kind].color : NO_KIND));
  function toast(msg) {
    const t = el('div', 'pp-anno-toast', msg);
    t.dataset.ppAnno = '1';
    t.dataset.ppRole = 'toast';
    root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ---------------- 样式（新交互模型） ---------------- */
  const STYLE = `
  .pp-anno-root{position:absolute;top:0;left:0;width:100%;height:0;font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.55;color:#11161b}
  .pp-anno-root *{box-sizing:border-box;margin:0;padding:0}
  .pp-anno-ic{display:inline-flex}.pp-anno-ic svg{display:block}
  .pp-anno-mode-on:not(.pp-anno-paused){cursor:crosshair}
  .pp-anno-mode-on:not(.pp-anno-paused) *:not(.pp-anno-root, .pp-anno-root *){cursor:crosshair!important}
  .pp-anno-hover-hint{outline:2px solid #0f7c72!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(15,124,114,.12)!important}
  .pp-anno-bound{outline:2px solid rgba(15,124,114,.85)!important;outline-offset:2px!important;box-shadow:0 0 0 5px rgba(15,124,114,.12)!important}
  /* ── 命令条（唯一全局 chrome，深近黑，绝不与宿主页混淆） ── */
  .pp-anno-bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:3px;background:#15191c;border-radius:999px;padding:6px;box-shadow:0 14px 40px -10px rgba(17,22,27,.55),0 2px 6px rgba(17,22,27,.3);max-width:calc(100vw - 20px)}
  .pp-anno-bar button{border:none;background:transparent;color:#cdd3d9;font:600 13px/1 'Hanken Grotesk',sans-serif;cursor:pointer;padding:8px 13px;border-radius:999px;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;transition:background .15s,color .15s}
  .pp-anno-bar button:hover{background:rgba(255,255,255,.08);color:#fff}
  .pp-anno-bar .pp-b-primary{background:#0f7c72;color:#fff}.pp-anno-bar .pp-b-primary:hover{background:#13988c}
  .pp-anno-bar .pp-b-soft{background:rgba(255,255,255,.1)}.pp-anno-bar .pp-b-soft:hover{background:rgba(255,255,255,.2)}
  .pp-anno-bar .pp-b-on{background:rgba(255,255,255,.2);color:#fff}
  .pp-anno-count{background:rgba(0,0,0,.28);font:600 11.5px/1 'JetBrains Mono',monospace;padding:2px 7px;border-radius:999px}
  .pp-anno-sep{width:1px;height:18px;background:rgba(255,255,255,.14);margin:0 3px}
  .pp-anno-dot{width:8px;height:8px;border-radius:50%;background:#14958a;box-shadow:0 0 0 4px rgba(20,149,138,.3);animation:ppPulse 1.6s ease-in-out infinite}
  @keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.45}}
  .pp-anno-bar .pp-lab-teal{color:#7fe3d6}
  .pp-anno-bar .pp-instr{color:#cdd3d9;font-weight:500;font-size:12.5px}
  .pp-anno-counter{font:600 14px/1 'JetBrains Mono',monospace;color:#fff;min-width:42px;text-align:center}
  .pp-anno-kindtag{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600}
  .pp-anno-kindtag i{width:7px;height:7px;border-radius:50%;display:inline-block}
  .pp-anno-rbtn{width:32px;height:32px;padding:0!important;justify-content:center}
  .pp-anno-kbd{font:500 10px/1 'JetBrains Mono',monospace;color:#6b7480;letter-spacing:.12em}
  /* ── pin（泪滴，kind 上色，白圈在任意宿主色上都清晰） ── */
  .pp-anno-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:2147482000}
  .pp-anno-pin{position:absolute;z-index:2147482600;width:30px;height:30px;border-radius:50% 50% 50% 4px;display:grid;place-items:center;color:#fff;font:700 12.5px/1 'Hanken Grotesk',sans-serif;cursor:pointer;transform:translate(-4px,-26px);border:2.5px solid #fff;box-shadow:0 3px 10px rgba(28,26,23,.3);user-select:none;transition:transform .15s,box-shadow .15s}
  .pp-anno-pin:hover{transform:translate(-4px,-26px) scale(1.12)}
  .pp-anno-pin.pp-anno-pulse{animation:ppPin .45s cubic-bezier(.2,1.6,.4,1)}
  @keyframes ppPin{0%{transform:translate(-4px,-26px) scale(0)}60%{transform:translate(-4px,-26px) scale(1.12)}100%{transform:translate(-4px,-26px) scale(1)}}
  .pp-anno-pin.pp-anno-resolved{filter:saturate(.4);box-shadow:0 2px 6px rgba(28,26,23,.2)}
  .pp-anno-pin.pp-anno-current{transform:translate(-4px,-26px) scale(1.18);z-index:2147482650}
  .pp-anno-pin.pp-anno-current:hover{transform:translate(-4px,-26px) scale(1.18)}
  .pp-anno-region{position:absolute;z-index:2147481900;border:2px solid;border-radius:5px;pointer-events:none;box-sizing:border-box}
  .pp-anno-region.pp-anno-resolved{opacity:.35;filter:saturate(.3)}
  .pp-anno-rubber{position:absolute;z-index:2147482700;border:2px dashed #0f7c72;background:rgba(15,124,114,.08);border-radius:5px;pointer-events:none;box-sizing:border-box}
  /* ── 弹层（at-pin 读/改面） ── */
  .pp-anno-popup{position:absolute;z-index:2147482500;width:300px;background:#fff;border-radius:13px;border:1px solid #e1e4e6;box-shadow:0 22px 60px -18px rgba(17,22,27,.36),0 4px 12px rgba(17,22,27,.1);overflow:hidden;animation:ppPop .16s cubic-bezier(.2,1.3,.4,1)}
  @keyframes ppPop{from{opacity:0;transform:translateY(6px) scale(.98)}}
  .pp-anno-popup.pp-anno-shaking{animation:ppShake .3s}
  @keyframes ppShake{0%,100%{margin-left:0}25%{margin-left:-7px}75%{margin-left:7px}}
  .pp-anno-accent{height:3px}
  .pp-anno-hd{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid #f0f1f2}
  .pp-anno-step{width:22px;height:22px;border:1px solid #e7e9eb;background:#fff;border-radius:6px;display:grid;place-items:center;cursor:pointer;color:#6b7480}
  .pp-anno-step:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-counter2{font:600 11.5px/1 'JetBrains Mono',monospace;color:#6b7480;padding:0 2px}
  .pp-anno-ops{margin-left:auto;display:flex;align-items:center;gap:2px}
  .pp-anno-ops button{border:none;background:none;cursor:pointer;color:#9aa1a9;padding:5px;border-radius:6px;display:inline-flex;font:600 12px/1 'Hanken Grotesk',sans-serif}
  .pp-anno-ops button:hover{background:#f1f3f4;color:#0f7c72}
  .pp-anno-del{color:#b14a42!important}
  .pp-anno-del.pp-anno-armed{color:#fff!important;background:#c2361b!important;padding:4px 9px!important}
  .pp-anno-msgs{padding:5px 0;max-height:200px;overflow-y:auto}
  .pp-anno-msg{display:flex;gap:9px;padding:8px 12px}
  .pp-anno-msg>div:last-child{flex:1;min-width:0}
  .pp-anno-ava{width:25px;height:25px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font:700 11px/1 'Hanken Grotesk',sans-serif}
  .pp-anno-who{font-size:12.5px;font-weight:600;color:#11161b}
  .pp-anno-when{font-size:11px;color:#b3b9bf;margin-left:6px;font-weight:400}
  .pp-anno-txt{font-size:13px;line-height:1.5;margin-top:2px;color:#34302b;word-break:break-word;white-space:pre-wrap}
  .pp-anno-chips{display:flex;gap:5px;padding:8px 12px;border-top:1px solid #f0f1f2;flex-wrap:nowrap;overflow-x:auto}
  .pp-anno-chip2{display:inline-flex;align-items:center;gap:5px;font:600 11px/1 'Hanken Grotesk',sans-serif;padding:4px 9px;border-radius:999px;border:1px solid #e1e4e6;background:#fff;color:#6b7480;cursor:pointer;white-space:nowrap}
  .pp-anno-chip2 i{width:6px;height:6px;border-radius:50%;display:inline-block}
  .pp-anno-chip2.pp-anno-on{color:#fff;border-color:transparent}
  .pp-anno-chip2.pp-anno-on i{background:#fff!important}
  .pp-anno-ft{padding:9px 12px 11px;border-top:1px solid #f0f1f2}
  .pp-anno-ft textarea{width:100%;border:1.5px solid #e1e4e6;border-radius:8px;padding:7px 10px;font:400 13px/1.5 'Hanken Grotesk',sans-serif;resize:none;background:#fff;color:#11161b}
  .pp-anno-ft textarea:focus{outline:none;border-color:#0f7c72}
  .pp-anno-ft-row{display:flex;align-items:center;gap:8px;margin-top:8px}
  .pp-anno-hint{font-size:11px;color:#b3b9bf}
  .pp-anno-send{margin-left:auto;background:#0f7c72;color:#fff;border:none;padding:6px 13px;border-radius:7px;font:600 12.5px/1 'Hanken Grotesk',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
  .pp-anno-send:hover{background:#0b6358}.pp-anno-send:disabled{opacity:.4;cursor:default}
  .pp-anno-ghost{background:#fff;border:1px solid #e1e4e6;color:#6b7480;padding:6px 12px;border-radius:7px;font:600 12.5px/1 'Hanken Grotesk',sans-serif;cursor:pointer}
  .pp-anno-ghost:hover{border-color:#0f7c72;color:#0f7c72}
  .pp-anno-seltag{margin-left:auto;font:600 11px/1 'JetBrains Mono',monospace;color:#b3b9bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
  /* ── List 暗色弹层 ── */
  .pp-anno-list{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:2147482900;width:330px;max-width:calc(100vw - 24px);background:#15191c;border-radius:13px;box-shadow:0 22px 60px -18px rgba(17,22,27,.6);overflow:hidden;animation:ppPop .16s cubic-bezier(.2,1.3,.4,1)}
  .pp-anno-list-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);color:#fff;font-weight:700;font-size:13.5px}
  .pp-anno-list-hd .pp-cnt{font:600 12px/1 'JetBrains Mono',monospace;color:#9aa1a9}
  .pp-anno-list-hd .pp-note{margin-left:auto;font-size:11px;color:#7fe3d6;font-weight:600}
  .pp-anno-list-body{max-height:320px;overflow-y:auto;padding:6px}
  .pp-anno-li{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;cursor:pointer}
  .pp-anno-li:hover{background:rgba(255,255,255,.06)}
  .pp-anno-li-num{width:19px;height:19px;border-radius:50% 50% 50% 3px;flex:none;display:grid;place-items:center;color:#fff;font:700 10.5px/1 'Hanken Grotesk',sans-serif}
  .pp-anno-li-who{font-size:12.5px;font-weight:600;color:#fff;flex:none}
  .pp-anno-li-kind{font-size:11.5px;font-weight:600;flex:none}
  .pp-anno-li-txt{font-size:12px;color:#9aa1a9;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pp-anno-li-note{font-size:11px;font-weight:600}
  .pp-anno-li-link{border:none;background:none;cursor:pointer;color:#9aa1a9;padding:3px;border-radius:6px;display:inline-flex;opacity:0}
  .pp-anno-li:hover .pp-anno-li-link{opacity:.8}.pp-anno-li-link:hover{opacity:1!important;color:#7fe3d6}
  .pp-anno-li.pp-anno-stale{background:rgba(176,132,35,.1)}
  .pp-anno-empty{text-align:center;color:#9aa1a9;font-size:12.5px;padding:34px 22px;line-height:1.7}
  /* ── caught-up / toast ── */
  .pp-anno-caught{display:inline-flex;align-items:center;gap:7px;padding:0 6px 0 13px;color:#7fe3d6;font-weight:600;font-size:13px}
  .pp-anno-toast{position:fixed;bottom:74px;left:50%;transform:translateX(-50%);z-index:2147483100;background:#15191c;color:#f3efe7;font-size:12.5px;font-weight:500;padding:9px 16px;border-radius:9px;box-shadow:0 10px 28px -8px rgba(15,124,114,.6);animation:ppPop .2s}
  @media (max-width:640px){.pp-anno-bar{flex-wrap:wrap;justify-content:center}.pp-anno-list{width:calc(100vw - 24px)}}
  `;

  /* ---------------- UI 骨架 ---------------- */
  let root, layer, bar, listEl;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = el('div', 'pp-anno-root');
    root.dataset.ppAnno = '1';
    root.dataset.ppReady = '1'; // e2e「层就绪」门
    layer = el('div', 'pp-anno-layer');
    bar = el('div', 'pp-anno-bar');
    bar.dataset.ppAnno = '1';
    bar.dataset.ppRole = 'bar';
    root.append(layer, bar);
    document.body.appendChild(root);
    renderBar();
  }

  /* ---------------- 命令条变形 ---------------- */
  const openCount = () => state.threads.filter((t) => !t.resolved).length;
  const barBtn = (label, icon, cls, act, onClick, title) => {
    const b = el('button', cls || null);
    if (icon) b.appendChild(svg(icon, 15));
    if (label != null) b.appendChild(document.createTextNode(label));
    if (act) b.dataset.ppAct = act;
    if (title) b.title = title;
    b.onclick = onClick;
    return b;
  };

  function renderBar() {
    if (!bar) return;
    bar.textContent = '';
    bar.dataset.ppMode = state.mode;
    if (state.mode === 'comment') {
      const dot = el('span', 'pp-anno-dot');
      const lab = el('span', 'pp-lab-teal pp-anno-kindtag', 'Comment mode');
      const instr = el('span', 'pp-instr', '⌘+click an element, or drag on an image');
      bar.append(dot, lab, instr, barBtn('Done', null, 'pp-b-soft', 'done', cancelComment));
      return;
    }
    if (state.mode === 'walk') {
      const u = unresolved();
      const i = u.findIndex((t) => t.id === state.walk.curId);
      if (i < 0 || !u.length) { // caught-up 形态
        const remaining = openCount();
        const c = el('span', 'pp-anno-caught');
        c.appendChild(svg(ICON.check, 15));
        c.appendChild(document.createTextNode(remaining ? `End of queue · ${remaining} open` : 'All caught up · 0 open'));
        bar.append(c, barBtn('Done', null, 'pp-b-soft', 'exit', exitWalk));
        return;
      }
      const lead = el('span', 'pp-anno-kindtag'); lead.style.color = '#cdd3d9'; lead.style.padding = '0 4px 0 8px';
      lead.appendChild(svg(ICON.play, 13)); lead.appendChild(document.createTextNode('Review walk'));
      const prev = barBtn(null, ICON.prev, 'pp-b-soft pp-anno-rbtn', 'prev', () => step(-1), 'Previous (K)');
      const counter = el('span', 'pp-anno-counter', `${i + 1}/${u.length}`);
      const cur = u[i];
      const tag = el('span', 'pp-anno-kindtag');
      const m = cur.kind && KIND[cur.kind];
      tag.style.color = m ? m.color : '#9aa1a9';
      const ti = el('i'); ti.style.background = m ? m.color : NO_KIND; tag.append(ti, document.createTextNode(m ? m.label : 'No kind'));
      const next = barBtn(null, ICON.next, 'pp-b-soft pp-anno-rbtn', 'next', () => step(1), 'Next (J)');
      const rn = barBtn('Resolve & next', ICON.check, 'pp-b-primary', 'resolve-next', resolveNext);
      const kbd = el('span', 'pp-anno-kbd', 'J K R');
      const exit = barBtn(null, ICON.x, 'pp-anno-rbtn', 'exit', exitWalk, 'Exit (Esc)');
      bar.append(lead, prev, counter, tag, next, el('div', 'pp-anno-sep'), rn, kbd, exit);
      return;
    }
    // resting
    const comment = barBtn('Comment', ICON.msg, 'pp-b-primary', 'comment', () => enterComment());
    const cnt = el('span', 'pp-anno-count', String(openCount()));
    comment.appendChild(cnt);
    const filter = barBtn(state.filter === 'open' ? 'Open' : 'All', ICON.filter, null, 'filter', toggleFilter);
    const whole = barBtn('Whole page', ICON.plus, null, 'whole', openComposerForPage);
    const list = barBtn('List', ICON.list, state.listOpen ? 'pp-b-on' : 'pp-b-soft', 'list', toggleList);
    const review = barBtn('Review', ICON.play, 'pp-b-soft', 'review', startReview);
    bar.append(comment, filter, whole, list, el('div', 'pp-anno-sep'), review);
  }

  function toggleFilter() { state.filter = state.filter === 'open' ? 'all' : 'open'; renderBar(); render(); }

  /* ---------------- 锚点解析（保留） ---------------- */
  const isPage = (t) => t.selector === PAGE_SELECTOR;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const fingerprint = (node) => norm(node.textContent).slice(0, 80);
  function pointVisible(node, cx, cy) {
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
  const visibleThreads = () => state.threads.filter((t) => state.filter === 'all' || !t.resolved);
  const unresolved = () => state.threads.filter((t) => !t.resolved); // Walk 队列 = 未解决，文档序
  const byId = (id) => state.threads.find((t) => t.id === id) || null;

  /* ---------------- 渲染 pin/region（保留几何，换 kind 上色） ---------------- */
  function render() {
    if (!layer) return;
    layer.querySelectorAll('.pp-anno-pin, .pp-anno-region').forEach((n) => n.remove());
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
      const col = kindColor(t);
      if (t.rw != null && t.rh != null && a.el) {
        const r = a.el.getBoundingClientRect();
        const reg = el('div', 'pp-anno-region' + (t.resolved ? ' pp-anno-resolved' : ''));
        reg.dataset.ppAnno = '1';
        reg.dataset.tid = t.id;
        reg.style.borderColor = col;
        reg.style.background = 'color-mix(in srgb, ' + col + ' 10%, transparent)';
        reg.style.left = (r.left + scrollX + r.width * t.rx) + 'px';
        reg.style.top = (r.top + scrollY + r.height * t.ry) + 'px';
        reg.style.width = (r.width * t.rw) + 'px';
        reg.style.height = (r.height * t.rh) + 'px';
        layer.appendChild(reg);
      }
      const pin = el('div', 'pp-anno-pin' + (t.resolved ? ' pp-anno-resolved' : '')
        + (state.openThreadId === t.id ? ' pp-anno-current' : ''));
      pin.dataset.ppAnno = '1';
      pin.dataset.ppRole = 'marker';
      pin.dataset.tid = t.id;
      pin.style.left = pos.x + 'px';
      pin.style.top = pos.y + 'px';
      pin.style.background = col;
      if (t.resolved) { pin.textContent = ''; pin.appendChild(svg(ICON.check, 14)); }
      else pin.textContent = String(n);
      pin.onclick = (e) => { e.stopPropagation(); gotoPin(t.id); };
      layer.appendChild(pin);
    }
    const open = openCount();
    const cntEl = bar && bar.querySelector('.pp-anno-count');
    if (cntEl) cntEl.textContent = String(open);
    if (state.listOpen) renderList();
  }

  /* ---------------- List 暗色弹层 ---------------- */
  function toggleList() { state.listOpen = !state.listOpen; if (state.listOpen) renderList(); else removeList(); syncFlags(); renderBar(); }
  function removeList() { if (listEl) { listEl.remove(); listEl = null; } }
  function renderList() {
    removeList();
    listEl = el('div', 'pp-anno-list');
    listEl.dataset.ppAnno = '1';
    listEl.dataset.ppRole = 'list';
    const u = unresolved();
    const hd = el('div', 'pp-anno-list-hd');
    hd.append(document.createTextNode('Open threads'), el('span', 'pp-cnt', String(u.length)), el('span', 'pp-note', 'document order'));
    listEl.appendChild(hd);
    const body = el('div', 'pp-anno-list-body');
    if (!u.length) {
      body.appendChild(el('div', 'pp-anno-empty', state.threads.length
        ? 'No open threads.' : 'No comments yet. Hold ⌘ and click any element to start a thread — or use Whole page for overall notes.'));
    } else {
      // 文档序：先 ok-anchor 的（带号），再 page/lost/changed
      const withNum = u.map((t) => ({ t, a: resolveAnchor(t) }));
      withNum.sort((x, y) => (x.t._num || 999) - (y.t._num || 999));
      for (const { t, a } of withNum) body.appendChild(listItem(t, a));
    }
    listEl.appendChild(body);
    root.appendChild(listEl);
  }
  function listItem(t, a) {
    const c0 = t.comments[0];
    const m = t.kind && KIND[t.kind];
    const stale = a.status === 'lost' || a.status === 'changed';
    const row = el('div', 'pp-anno-li' + (stale ? ' pp-anno-stale' : ''));
    row.dataset.ppRole = 'list-item';
    row.dataset.tid = t.id;
    row.dataset.ppStatus = a.status;
    const num = el('span', 'pp-anno-li-num', isPage(t) ? '¶' : (stale ? '!' : (t._num != null ? String(t._num) : '•')));
    num.style.background = isPage(t) ? '#5d574d' : (stale ? '#b08423' : (m ? m.color : NO_KIND));
    if (stale) { num.style.background = '#fff8ee'; num.style.color = '#b08423'; num.style.border = '1.5px dashed #aab2bb'; }
    const who = el('span', 'pp-anno-li-who', c0.author_name);
    row.append(num, who);
    if (m) { const k = el('span', 'pp-anno-li-kind', m.label); k.style.color = m.color; row.appendChild(k); }
    const note = stale
      ? el('span', 'pp-anno-li-note', `⚠ Anchor lost — was on ${t.selector}`)
      : el('span', 'pp-anno-li-txt', c0.text);
    if (stale) note.style.color = '#b08423';
    row.appendChild(note);
    const link = el('button', 'pp-anno-li-link');
    link.dataset.ppRole = 'copy-link';
    link.title = 'Copy link';
    link.appendChild(svg(ICON.link, 13));
    link.onclick = (e) => { e.stopPropagation(); copyThreadLink(t); };
    row.appendChild(link);
    row.onclick = () => { gotoPin(t.id); };
    return row;
  }

  /* ---------------- 弹层定位（保留） ---------------- */
  let popupTarget = null;
  function setBound(node) {
    document.querySelectorAll('.pp-anno-bound').forEach((n) => n.classList.remove('pp-anno-bound'));
    if (node && node !== document.body && !node.closest('[data-pp-anno]')) node.classList.add('pp-anno-bound');
  }
  function threadEl(t) {
    if (isPage(t)) return null;
    try { return document.querySelector(t.selector); } catch (e) { return null; }
  }
  function positionPopup(p, x, y) {
    const w = p.offsetWidth || 300, h = p.offsetHeight || 240;
    const vw = document.documentElement.clientWidth;
    // 侧向感知：优先放 pin 右侧，放不下翻左侧
    let left = x + 30;
    if (left + w > scrollX + vw - 12) left = x - w - 18;
    p.style.left = Math.max(scrollX + 8, left) + 'px';
    let top = y - 18;
    if (top + h > scrollY + innerHeight - 12) top = scrollY + innerHeight - h - 12;
    p.style.top = Math.max(scrollY + 8, top) + 'px';
  }
  const centerPos = () => ({ x: scrollX + document.documentElement.clientWidth / 2 - 150, y: scrollY + innerHeight / 3 });

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
    void p.offsetWidth;
    p.classList.add('pp-anno-shaking');
    p.querySelector('textarea')?.focus();
    if (Date.now() - lastShakeHint > 2500) { lastShakeHint = Date.now(); toast('Unsent comment — post it, or press Esc to discard'); }
  }
  const draftStash = new Map();

  function closePopup(force) {
    if (!state.openPopup) return true;
    const ta = state.openPopup.querySelector('textarea');
    const draft = ta ? ta.value.trim() : '';
    if (state.openThreadId) {
      if (force || !draft) draftStash.delete(state.openThreadId);
      else draftStash.set(state.openThreadId, ta.value);
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
    layer.querySelectorAll('.pp-anno-pin.pp-anno-current').forEach((n) => n.classList.remove('pp-anno-current'));
    syncFlags();
    return true;
  }
  function popupShell(x, y, role) {
    if (!closePopup()) return null;
    const p = el('div', 'pp-anno-popup');
    p.dataset.ppAnno = '1';
    p.dataset.ppRole = role;
    layer.appendChild(p);
    state.openPopup = p;
    syncFlags();
    if (hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.visibility = 'hidden';
    requestAnimationFrame(() => { positionPopup(p, x, y); p.style.visibility = ''; });
    return p;
  }

  // 通用 footer（textarea + 提交）
  function footer(p, placeholder, hint, btnLabel, btnIcon, onSubmit, extraLeft) {
    const ft = el('div', 'pp-anno-ft');
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.placeholder = placeholder;
    const row = el('div', 'pp-anno-ft-row');
    if (extraLeft) row.appendChild(extraLeft);
    row.appendChild(el('span', 'pp-anno-hint', hint));
    const send = el('button', 'pp-anno-send');
    send.dataset.ppRole = 'send';
    if (btnIcon) send.appendChild(svg(btnIcon, 14));
    send.appendChild(document.createTextNode(btnLabel));
    row.appendChild(send);
    ft.append(ta, row);
    p.appendChild(ft);
    const submit = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      send.disabled = true;
      try { await onSubmit(text); } catch (e) { toast(e.message || 'Failed'); send.disabled = false; }
    };
    send.onclick = submit;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } };
    return ta;
  }

  // kind chips（composer 默认 copy；thread 反映当前 kind）
  function kindChips(selected, onPick, readonly) {
    const wrap = el('div', 'pp-anno-chips');
    for (const k of KIND_KEYS) {
      const m = KIND[k];
      const b = el('button', 'pp-anno-chip2' + (selected === k ? ' pp-anno-on' : ''));
      b.dataset.ppKind = k;
      const dot = el('i'); dot.style.background = m.color;
      b.append(dot, document.createTextNode(m.label));
      if (selected === k) b.style.background = m.color;
      if (readonly) b.style.cursor = 'default';
      else b.onclick = () => onPick(k, b, wrap);
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* ---------------- composer（评论模式打点） ---------------- */
  function openComposer(x, y, selector, rx, ry, box) {
    const p = popupShell(x, y, 'composer');
    if (!p) return;
    const accent = el('div', 'pp-anno-accent'); accent.style.background = 'linear-gradient(90deg,#0f7c72,#14958a)';
    p.appendChild(accent);
    if (selector !== PAGE_SELECTOR) {
      try { popupTarget = document.querySelector(selector); } catch (e) { popupTarget = null; }
      setBound(popupTarget);
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
    const hd = el('div', 'pp-anno-hd');
    hd.dataset.ppRole = 'composer-head';
    const title = el('span', 'pp-anno-who', selector === PAGE_SELECTOR ? 'Whole page' : 'New comment');
    hd.appendChild(title);
    if (selector !== PAGE_SELECTOR) {
      const tag = el('span', 'pp-anno-seltag', selector);
      hd.appendChild(tag);
    }
    p.appendChild(hd);
    let kind = null; // 默认无选中（design 默认 Copy，但允许无 kind 提交）
    const chips = kindChips(kind, (k, b, wrap) => {
      kind = kind === k ? null : k;
      wrap.querySelectorAll('.pp-anno-chip2').forEach((x) => { x.classList.remove('pp-anno-on'); x.style.background = ''; });
      if (kind) { b.classList.add('pp-anno-on'); b.style.background = KIND[kind].color; }
      p.dataset.ppKind = kind || '';
    });
    p.appendChild(chips);
    const cancel = el('button', 'pp-anno-ghost', 'Cancel');
    cancel.onclick = () => { closePopup(true); };
    const ta = footer(p, selector === PAGE_SELECTOR ? 'Say something about the whole page…' : 'Say something…',
      box ? 'Esc to discard' : 'or drag on an image to box a region', 'Post', null, async (text) => {
        const anchor_text = popupTarget && selector !== PAGE_SELECTOR ? fingerprint(popupTarget) || null : null;
        const t = await createThread({
          path: CFG.path, selector, rx, ry,
          rw: box ? box.rw : null, rh: box ? box.rh : null, kind, anchor_text, text,
        });
        state.threads.push(t);
        closePopup(true);
        render();
        const pin = layer.querySelector(`.pp-anno-pin[data-tid="${t.id}"]`);
        if (pin) pin.classList.add('pp-anno-pulse');
        else toast('Whole-page note recorded');
      }, cancel);
    ta.focus();
  }
  const openComposerForPage = () => { setMode('rest'); openComposer(centerPos().x, centerPos().y, PAGE_SELECTOR, 0, 0); };

  /* ---------------- 深链复制（保留，英文化） ---------------- */
  async function copyThreadLink(t) {
    const url = location.href.split('#')[0] + '#pp-comment-' + t.id;
    try { await navigator.clipboard.writeText(url); }
    catch (e) {
      const tmp = el('textarea'); tmp.dataset.ppAnno = '1'; tmp.value = url;
      tmp.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(tmp); tmp.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      tmp.remove();
    }
    toast('Link copied');
  }

  /* ---------------- Review Walk + at-pin 弹层 ---------------- */
  function enterComment() { setMode('comment'); }
  function cancelComment() { closePopup(true); setMode('rest'); }
  // 单点维护两个宿主级标记（imgShell Esc 据此让权，crosshair CSS 据此暂停）：
  //  mode-on = 评论模式（无弹层时出十字光标）；paused = 弹层/列表/Walk 正占用交互
  function syncFlags() {
    const de = document.documentElement;
    de.classList.toggle('pp-anno-mode-on', state.mode === 'comment');
    de.classList.toggle('pp-anno-paused', !!state.openPopup || state.listOpen || state.mode === 'walk');
  }
  function setMode(m) {
    state.mode = m;
    if (m !== 'comment' && hoverHint) { hoverHint.classList.remove('pp-anno-hover-hint'); hoverHint = null; }
    syncFlags();
    renderBar();
  }

  function startReview() {
    if (state.listOpen) toggleList();
    const u = unresolved();
    state.walk.resolvedThisPass = 0;
    if (!u.length) { setMode('walk'); state.walk.curId = null; state.walk.entryTop = true; closePopup(true); render(); renderBar(); return; }
    state.walk.entryTop = true;
    setMode('walk');
    goTo(u[0].id);
  }
  function gotoPin(id) {
    if (state.listOpen) toggleList();
    const u = unresolved();
    const i = u.findIndex((t) => t.id === id);
    if (i < 0) { // 已解决线程（filter=all 时点了）：直接开弹层，不进队列
      const t = byId(id); if (t) { setMode('walk'); goTo(id); }
      return;
    }
    if (state.mode !== 'walk') state.walk.entryTop = (i === 0);
    setMode('walk');
    goTo(id);
  }
  function goTo(id) {
    const t = byId(id);
    if (!t) return;
    state.walk.curId = id;
    const a = resolveAnchor(t);
    // 立即开弹层（pin 切换要跟手）；随后 scrollIntoView，弹层经 render 的 _getPos 跟随滚动
    openPopover(t, a.pos || centerPos());
    if (a.el) a.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderBar();
    try { history.replaceState(null, '', location.pathname + location.search + '#pp-comment-' + id); } catch (e) { /* ignore */ }
  }
  function step(d) {
    const u = unresolved();
    let i = u.findIndex((t) => t.id === state.walk.curId);
    if (i < 0) i = d > 0 ? -1 : u.length; // 当前线程不在队列（已解决）：J 从队首、K 从队尾起步
    const ni = i + d;
    if (ni < 0) return;
    if (ni >= u.length) { caughtUp(); return; }
    goTo(u[ni].id);
  }
  function caughtUp() {
    state.walk.curId = null;
    closePopup(true);
    render();
    renderBar();
  }
  function exitWalk() {
    setMode('rest');
    state.walk.curId = null;
    closePopup(true);
    render();
    renderBar();
  }
  let resolveInFlight = false;
  async function resolveNext() {
    if (resolveInFlight) return; // 连按 R 防重复 PATCH / 双跳
    const id = state.walk.curId;
    const t = byId(id);
    if (!t) { step(1); return; }
    const u = unresolved();
    const i = u.findIndex((x) => x.id === id);
    resolveInFlight = true;
    let ok = false;
    try {
      const updated = await patchThread(t.id, true);
      Object.assign(t, updated);
      state.walk.resolvedThisPass += 1;
      ok = true;
    } catch (e) { toast(e.message || 'Failed'); }
    resolveInFlight = false;
    if (!ok) return;
    const u2 = unresolved(); // 不含 t
    // 先把游标移到下一条再 render，避免命令条闪现一帧 caught-up
    state.walk.curId = i >= 0 && i < u2.length ? u2[i].id : null;
    render();
    if (state.walk.curId) goTo(state.walk.curId);
    else caughtUp();
  }

  function openPopover(t, pos, focusReply) {
    const p = popupShell(pos.x, pos.y, 'popover');
    if (!p) return;
    state.openThreadId = t.id;
    state.walk.curId = t.id;
    p.dataset.ppThread = t.id;
    p.dataset.ppNum = isPage(t) ? 'page' : (t._num != null ? String(t._num) : '');
    popupTarget = threadEl(t);
    setBound(popupTarget);
    p._getPos = () => resolveAnchor(t).pos;
    layer.querySelectorAll('.pp-anno-pin').forEach((n) => n.classList.toggle('pp-anno-current', n.dataset.tid === t.id));
    const accent = el('div', 'pp-anno-accent'); accent.style.background = kindColor(t); p.appendChild(accent);

    // header: ◀ n/N ▶ + copy-link + delete + exit
    const hd = el('div', 'pp-anno-hd');
    const u = unresolved();
    const i = u.findIndex((x) => x.id === t.id);
    const prev = el('button', 'pp-anno-step'); prev.appendChild(svg(ICON.prev, 13)); prev.title = 'Previous (K)';
    prev.dataset.ppAct = 'prev'; prev.onclick = () => step(-1);
    const counter = el('span', 'pp-anno-counter2', i >= 0 ? `${i + 1} / ${u.length}` : '–');
    const next = el('button', 'pp-anno-step'); next.appendChild(svg(ICON.next, 13)); next.title = 'Next (J)';
    next.dataset.ppAct = 'next'; next.onclick = () => step(1);
    hd.append(prev, counter, next);
    const ops = el('div', 'pp-anno-ops');
    const linkBtn = el('button'); linkBtn.dataset.ppRole = 'copy-link'; linkBtn.title = 'Copy link'; linkBtn.appendChild(svg(ICON.link, 14));
    linkBtn.onclick = () => copyThreadLink(t);
    ops.appendChild(linkBtn);
    const mine = state.viewer && t.comments[0].author_sub === state.viewer.sub;
    if (mine) {
      const delBtn = el('button', 'pp-anno-del', 'Delete'); delBtn.title = 'Delete';
      let disarm = null;
      delBtn.onclick = async () => {
        if (!delBtn.dataset.armed) {
          delBtn.dataset.armed = '1'; delBtn.textContent = 'Delete?'; delBtn.classList.add('pp-anno-armed');
          disarm = setTimeout(() => { delete delBtn.dataset.armed; delBtn.textContent = 'Delete'; delBtn.classList.remove('pp-anno-armed'); }, 3000);
          return;
        }
        clearTimeout(disarm);
        try {
          await deleteThread(t.id);
          const wasIdx = unresolved().findIndex((x) => x.id === t.id);
          state.threads = state.threads.filter((x) => x.id !== t.id);
          render();
          const u2 = unresolved();
          if (state.mode === 'walk' && wasIdx >= 0 && wasIdx < u2.length) goTo(u2[wasIdx].id);
          else if (state.mode === 'walk') caughtUp();
          else closePopup(true);
        } catch (e) { toast(e.message || 'Delete failed'); }
      };
      ops.appendChild(delBtn);
    }
    const exit = el('button'); exit.dataset.ppAct = 'exit'; exit.title = 'Exit (Esc)'; exit.appendChild(svg(ICON.x, 14));
    exit.onclick = () => exitWalk();
    ops.appendChild(exit);
    hd.appendChild(ops);
    p.appendChild(hd);

    // messages
    const msgs = el('div', 'pp-anno-msgs');
    t.comments.forEach((c) => {
      const m = el('div', 'pp-anno-msg');
      const ava = el('div', 'pp-anno-ava', initialOf(c.author_name));
      ava.style.background = avatarColor(c.author_name);
      const right = el('div');
      const line = el('div');
      line.append(el('span', 'pp-anno-who', c.author_name), el('span', 'pp-anno-when', fmtTime(c.created_at)));
      right.append(line, el('div', 'pp-anno-txt', c.text));
      m.append(ava, right);
      msgs.appendChild(m);
    });
    p.appendChild(msgs);

    // kind chips：只读展示线程当前 kind（高亮）。kind 在创建时由 composer 设定并持久化；
    // 改已有线程的 kind 需后端 PATCH 端点（无该端点时不做「假可点」误导，留待阶段 4）。
    p.appendChild(kindChips(t.kind, null, true));

    // footer: reply 输入 + Resolve & next（同一按钮：有草稿先发回复，无草稿则解决并前进）
    const ta = footer(p, 'Reply…', 'Enter to reply', 'Resolve & next', ICON.check, async () => {});
    const sendBtn = p.querySelector('.pp-anno-send');
    const sendReply = async () => {
      const txt = ta.value.trim();
      if (!txt) { void resolveNext(); return; } // 无草稿 → resolve-and-advance
      sendBtn.disabled = true;
      try {
        const reply = await addReply(t.id, txt);
        t.comments.push(reply);
        ta.value = ''; // 先清空，避免 closePopup 把已发回复当草稿暂存
        draftStash.delete(t.id);
        render();
        openPopover(byId(t.id) || t, pos, true);
      } catch (e) { toast(e.message || 'Failed'); sendBtn.disabled = false; }
    };
    sendBtn.onclick = sendReply;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply(); } };
    const stashed = draftStash.get(t.id);
    if (stashed) ta.value = stashed;
    msgs.scrollTop = 1e5;
    if (focusReply) requestAnimationFrame(() => requestAnimationFrame(() => { const f = p.querySelector('textarea'); if (f) f.focus(); }));
  }

  /* ---------------- 评论模式 hover + 打点（保留） ---------------- */
  let hoverHint = null;
  document.addEventListener('mouseover', (e) => {
    if (state.mode !== 'comment' || state.openPopup) return;
    if (hoverHint) hoverHint.classList.remove('pp-anno-hover-hint');
    hoverHint = e.target.closest('[data-pp-anno]') ? null : e.target;
    if (hoverHint && hoverHint !== document.body) hoverHint.classList.add('pp-anno-hover-hint');
  }, true);
  const modeArmed = (e) =>
    state.mode === 'comment' &&
    !document.documentElement.classList.contains('pp-anno-paused') &&
    !(e.target.closest && e.target.closest('[data-pp-anno]'));
  document.addEventListener('dragstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);
  document.addEventListener('selectstart', (e) => { if (modeArmed(e)) e.preventDefault(); }, true);

  /* ---------------- 图片框选（保留几何） ---------------- */
  let suppressNextClick = false;
  document.addEventListener('mousedown', (down) => {
    if (state.mode !== 'comment' || state.openPopup || down.button !== 0) return;
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
        rubber = el('div', 'pp-anno-rubber'); rubber.dataset.ppAnno = '1'; layer.appendChild(rubber);
      }
      const g = geom(e);
      rubber.style.left = (g.x1 + scrollX) + 'px'; rubber.style.top = (g.y1 + scrollY) + 'px';
      rubber.style.width = g.w + 'px'; rubber.style.height = g.h + 'px';
    };
    const onUp = (e) => {
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
      if (!rubber) return;
      rubber.remove();
      suppressNextClick = true;
      const g = geom(e);
      if (g.w < 8 || g.h < 8) return;
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
    openComposer(e.pageX, e.pageY, cssPath(node), Math.min(1, Math.max(0, rx)), Math.min(1, Math.max(0, ry)));
  }

  document.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-pp-anno]')) return;
    if (state.mode === 'comment' || e.altKey || (e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      // 两步式：composer 开着时这次点击只收掉它（空稿关、有稿抖动），⌥/⌘ 是明确意图直接弹
      if (state.openPopup && state.openThreadId === null && !e.altKey && !e.metaKey) { closePopup(); return; }
      composeAt(e);
      return;
    }
    closePopup(); // 普通点空白：关弹层（草稿保护内置）
  }, true);

  /* ---------------- 键盘（保留 + Walk 感知） ---------------- */
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')
      || (document.activeElement && document.activeElement.isContentEditable);
    if (e.key === 'Escape') {
      if (state.mode === 'comment') { cancelComment(); return; }
      if (state.mode === 'walk') { if (closePopup(true)) exitWalk(); return; }
      closePopup(true);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') { state.mode === 'comment' ? setMode('rest') : enterComment(); }
    else if (e.key === 'g' || e.key === 'G') openComposerForPage();
    else if (state.mode === 'walk') {
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); step(1); }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); step(-1); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); void resolveNext(); }
    } else if (e.key === 'r' || e.key === 'R') { startReview(); }
  });

  addEventListener('resize', () => render());
  addEventListener('load', () => render());

  /* ---------------- 跟随重摆（保留） ---------------- */
  let rafPending = false;
  function scheduleRender() {
    if (!layer || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }
  document.addEventListener('scroll', (e) => { if (e.target !== document) scheduleRender(); }, true);
  new MutationObserver((muts) => {
    for (const m of muts) {
      const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (n && n.closest && n.closest('[data-pp-anno]')) continue;
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const before = (m.oldValue || '').split(/\s+/).filter(Boolean);
        const after = [...m.target.classList];
        const diff = before.filter((x) => !after.includes(x)).concat(after.filter((x) => !before.includes(x)));
        if (diff.length && diff.every((cls) => cls.startsWith('pp-anno-'))) continue;
      }
      scheduleRender();
      return;
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeOldValue: true,
    attributeFilter: ['style', 'class', 'src', 'width', 'height', 'open', 'hidden'],
  });

  /* ---------------- 静默刷新（保留） ---------------- */
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    if (state.openPopup) return;
    try {
      const data = await fetchThreads();
      const before = JSON.stringify(state.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      const after = JSON.stringify(data.threads.map((t) => [t.id, t.comments.length, t.resolved]));
      if (before !== after) { state.threads = data.threads; render(); }
    } catch (e) { /* 静默 */ }
  }
  setInterval(refresh, 30000);
  addEventListener('focus', refresh);

  /* ---------------- 图片查看器壳就地换路径（保留契约） ---------------- */
  addEventListener('pagepin:navigate', (e) => {
    const next = e && e.detail && e.detail.path;
    if (!next || next === CFG.path) return;
    if (!closePopup()) { e.preventDefault(); return; }
    CFG.path = next;
    state.threads = [];
    state.walk.curId = null;
    if (state.mode === 'walk') setMode('rest');
    render();
    fetchThreads().then((data) => { state.threads = data.threads; render(); }).catch(() => { /* 静默 */ });
  });

  /* ---------------- 深链 #pp-comment-<id>（保留 id 形态宽匹配） ---------------- */
  function maybeDeepLink() {
    const m = location.hash.match(/^#pp-comment-([\w-]{8,})$/);
    if (!m) return;
    const t = state.threads.find((x) => x.id === m[1]);
    if (!t) return;
    if (t.resolved && state.filter !== 'all') { state.filter = 'all'; render(); renderBar(); }
    setTimeout(() => gotoPin(t.id), 300);
  }

  /* ---------------- 启动（保留身份门控） ---------------- */
  async function boot() {
    try { state.viewer = await api('/api/viewer'); }
    catch (e) { return; } // 匿名访客：不渲染任何 UI
    buildUI();
    try {
      const data = await fetchThreads();
      state.threads = data.threads;
    } catch (e) {
      if (e.status === 403) { root.remove(); return; } // 站点已关评论
      toast('Failed to load comments: ' + (e.message || ''));
    }
    render();
    maybeDeepLink();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot());
  else void boot();
})();
