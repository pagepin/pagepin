/** Site role resolution — a pure function. This change ships only the data layer (tables + resolver); route wiring lands in follow-up changes.
 *
 * Resolution order: the site owner (sites.ownerId) always resolves as owner; otherwise the highest of the member role and the grant role wins;
 * group grants cap at editor — an IdP group must not carry owner powers such as site deletion (all four values are stored; a grant of owner resolves as editor).
 * open mode (the default, identical to v0.3.0) unions the result with the logged-in baseline (view + comment); a member row never narrows rights;
 * in members mode a user without a row holds nothing. This file has no imports, no DB access, and no callers.
 */

export type SiteRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export type SiteAccessMode = 'open' | 'members';

export interface SiteAccess {
  role: SiteRole | null; // null = no member row and no matching grant (display only; capabilities are authoritative)
  capabilities: {
    view: boolean; // view a private site
    comment: boolean; // post or reply to comments
    deploy: boolean; // deploys, drafts, and rollbacks
    manage: boolean; // settings, share links, site delete, thread management (owner only)
  };
}

export interface SiteAccessInput {
  isOwner: boolean; // requester == sites.ownerId
  memberRole: SiteRole | null; // role from the site_members row; no row = null
  grantRole: SiteRole | null; // highest group_grants row hit through user_groups; none = null
  mode: SiteAccessMode; // the instance site_access_mode (default open)
}

const RANK: Record<SiteRole, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

const CAPS: Record<SiteRole, SiteAccess['capabilities']> = {
  owner: { view: true, comment: true, deploy: true, manage: true },
  editor: { view: true, comment: true, deploy: true, manage: false },
  commenter: { view: true, comment: true, deploy: false, manage: false },
  viewer: { view: true, comment: false, deploy: false, manage: false },
};

/** Pure inputs -> effective role + capability set; route wiring resolves once per request (follow-up change). */
export function resolveSiteAccess({
  isOwner,
  memberRole,
  grantRole,
  mode,
}: SiteAccessInput): SiteAccess {
  if (isOwner) return { role: 'owner', capabilities: { ...CAPS.owner } };

  const grant: SiteRole | null =
    grantRole == null ? null : grantRole === 'owner' ? 'editor' : grantRole;
  let best: SiteRole | null = null;
  for (const r of [memberRole, grant])
    if (r != null && (best == null || RANK[r] > RANK[best])) best = r;

  const capabilities = best
    ? { ...CAPS[best] }
    : { view: false, comment: false, deploy: false, manage: false };
  if (mode === 'open') {
    capabilities.view = true; // logged-in baseline: in open mode every logged-in user can view and comment (v0.3.0 behavior unchanged)
    capabilities.comment = true;
  }
  return { role: best, capabilities };
}
