/** Site role resolver unit tests — a pure-function matrix, no DB (see src/rbac.ts).
 *
 * Covers: member rows and group grants across all four roles vs the members-mode capability ladder; grant owner caps at editor;
 * extend-never-demote; open (default) unions the members result with the logged-in baseline; row-less users in both modes; the owner always wins.
 *
 * Run: node --import tsx --test test/rbac-resolution.test.ts (see test:unit in package.json).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveSiteAccess, type SiteRole } from '../src/rbac.js';

test('members 模式:成员行四种角色的能力阶梯', () => {
  const ladder = [
    ['owner', { view: true, comment: true, deploy: true, manage: true }],
    ['editor', { view: true, comment: true, deploy: true, manage: false }],
    ['commenter', { view: true, comment: true, deploy: false, manage: false }],
    ['viewer', { view: true, comment: false, deploy: false, manage: false }],
  ] as [SiteRole, ReturnType<typeof resolveSiteAccess>['capabilities']][];
  for (const [role, capabilities] of ladder) {
    const r = resolveSiteAccess({
      isOwner: false,
      memberRole: role,
      grantRole: null,
      mode: 'members',
    });
    assert.equal(r.role, role, `成员 ${role} 原样解析`);
    assert.deepEqual(r.capabilities, capabilities, `${role} 能力阶梯`);
  }
});

test('members 模式:组授予四种角色,owner 封顶 editor', () => {
  for (const [grant, role, comment] of [
    ['owner', 'editor', true],
    ['editor', 'editor', true],
    ['commenter', 'commenter', true],
    ['viewer', 'viewer', false],
  ] as [SiteRole, SiteRole, boolean][]) {
    const r = resolveSiteAccess({
      isOwner: false,
      memberRole: null,
      grantRole: grant,
      mode: 'members',
    });
    assert.equal(r.role, role, `授予 ${grant} 解析为 ${role}`);
    assert.deepEqual(
      r.capabilities,
      { view: true, comment, deploy: role === 'editor', manage: false },
      `授予 ${grant} 不给 manage`,
    );
  }
});

test('就高不降权:成员 × 授予取最高,封顶后再组合', () => {
  for (const [memberRole, grantRole, want] of [
    ['editor', 'viewer', 'editor'],
    ['viewer', 'editor', 'editor'],
    ['commenter', 'viewer', 'commenter'], // a lower grant does not demote the member role
    ['viewer', 'owner', 'editor'], // capped to editor, then combined
    ['owner', null, 'owner'], // member rows are not capped (only group grants are)
    [null, 'commenter', 'commenter'],
  ] as [SiteRole | null, SiteRole | null, SiteRole][]) {
    const r = resolveSiteAccess({ isOwner: false, memberRole, grantRole, mode: 'members' });
    assert.equal(r.role, want, `${memberRole} × ${grantRole} → ${want}`);
  }
});

test('open 模式并上已登录基线(view + comment);members 下无行者一无所有', () => {
  // row-less user: open = the v0.3.0 baseline, members = nothing
  const open = resolveSiteAccess({
    isOwner: false,
    memberRole: null,
    grantRole: null,
    mode: 'open',
  });
  assert.equal(open.role, null);
  assert.deepEqual(
    open.capabilities,
    { view: true, comment: true, deploy: false, manage: false },
    'open 基线',
  );
  const members = resolveSiteAccess({
    isOwner: false,
    memberRole: null,
    grantRole: null,
    mode: 'members',
  });
  assert.deepEqual(
    members.capabilities,
    { view: false, comment: false, deploy: false, manage: false },
    'members 空手',
  );

  // viewer member: open keeps the comment right (baseline union; member rows never demote); members does not
  const o = resolveSiteAccess({
    isOwner: false,
    memberRole: 'viewer',
    grantRole: null,
    mode: 'open',
  });
  assert.equal(o.role, 'viewer');
  assert.deepEqual(o.capabilities, { view: true, comment: true, deploy: false, manage: false });
  const m = resolveSiteAccess({
    isOwner: false,
    memberRole: 'viewer',
    grantRole: null,
    mode: 'members',
  });
  assert.deepEqual(m.capabilities, { view: true, comment: false, deploy: false, manage: false });

  // editor grant: identical in both modes (the capability set already includes the baseline)
  for (const mode of ['open', 'members'] as const) {
    const g = resolveSiteAccess({ isOwner: false, memberRole: null, grantRole: 'editor', mode });
    assert.deepEqual(g.capabilities, { view: true, comment: true, deploy: true, manage: false });
  }
});

test('站长恒赢:isOwner 忽略角色行与模式', () => {
  for (const mode of ['open', 'members'] as const) {
    const r = resolveSiteAccess({ isOwner: true, memberRole: null, grantRole: null, mode });
    assert.equal(r.role, 'owner', `owner 原样 (${mode})`);
    assert.deepEqual(
      r.capabilities,
      { view: true, comment: true, deploy: true, manage: true },
      `owner 全权 (${mode})`,
    );
  }
  const down = resolveSiteAccess({
    isOwner: true,
    memberRole: 'viewer',
    grantRole: 'commenter',
    mode: 'members',
  });
  assert.equal(down.role, 'owner', '成员/授予行不降站长');
  assert.equal(down.capabilities.manage, true);
});
