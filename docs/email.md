# Email setup

How pagepin's email is wired, and the single source of truth for every address on
`pagepin.ai`. **Sending** goes through Resend; **receiving** goes through Cloudflare
Email Routing. The two coexist on the same domain because they live on different
hostnames (see [DNS & coexistence](#dns--coexistence)).

> Scope: this is the operational runbook for the project's own mailboxes
> (`notifications@`, `legal@`, …). It is unrelated to per-user account-verification
> mail, which is just transactional mail sent via the same Resend pipe.

## At a glance

| Direction | Provider | What it does |
| --- | --- | --- |
| Outbound | **Resend** | Transactional mail (account verification, notifications). Domain-verified `pagepin.ai`. |
| Inbound | **Cloudflare Email Routing** (free) | Forwards every role address + catch-all to one real inbox. Can route to a Worker later. |
| Reports | DMARC `rua` | Aggregate reports, via a mailbox or Cloudflare DMARC Management. |

Why split: Resend is a sending pipe; its "inbound" is webhook-to-app (parsed JSON
POSTed to an endpoint), not a mailbox. Role addresses like `abuse@` / `legal@` are
human-read, so they need forward-to-inbox — which is exactly Cloudflare Email
Routing's job, and DNS is already on Cloudflare.

## Address inventory (single source of truth)

| Address | Purpose | Defined / referenced in |
| --- | --- | --- |
| `notifications@pagepin.ai` | Outbound transactional **From**. Replies route back to the inbox (not a no-reply). | `wrangler.jsonc` → `PAGEPIN_MAIL_FROM` |
| `legal@pagepin.ai` | Legal / privacy / GDPR data requests | `pagepin-site/terms.html`, `privacy.html` |
| `abuse@pagepin.ai` | Abuse / infringing-content reports | `pagepin-site/terms.html`, `acceptable-use.html`, `abuse.html`, `privacy.html` |
| `security@pagepin.ai` | Security vulnerability reports | `pagepin-site/abuse.html` |
| `social@pagepin.ai` | Official X / social-account registration (keeps the brand off a personal address) | — (account-level, not in code) |
| `dmarc@pagepin.ai` | DMARC aggregate-report `rua` target (or use Cloudflare DMARC Management) | DNS `_dmarc` TXT |

`fivesmallq@gmail.com` is the **Cloudflare account owner**, not a functional address
— do not publish it. `noreply@pagepin.ai` is **retired** (replaced by
`notifications@`); do not reintroduce it.

Rule of thumb: any new public address must (a) be added to this table and
(b) have a Cloudflare Email Routing rule before it is published anywhere.

## Sending (Resend)

- Resend verifies at the **domain** level (`pagepin.ai`): DKIM, SPF and the
  return-path all bind to the domain, not the localpart. So you can send `From:`
  **any** `…@pagepin.ai` address, and changing the localpart (e.g. `noreply@` →
  `notifications@`) needs **no** re-verification and **no** DNS change.
- The `From:` domain must match the verified domain. Sending as
  `notifications@pagepin.ai` requires `pagepin.ai` to show **Verified** in
  Resend → Domains.
- Config (Workers target): `PAGEPIN_MAIL_PROVIDER=resend`,
  `PAGEPIN_MAIL_FROM="pagepin <notifications@pagepin.ai>"` in `wrangler.jsonc`
  `vars`; `PAGEPIN_RESEND_API_KEY` via `wrangler secret put`.
- Node self-hosted target reads the same vars from the process env — if you run
  it, keep `PAGEPIN_MAIL_FROM` in sync there too. `src/config.ts` has **no**
  hardcoded default; it throws if `PAGEPIN_MAIL_FROM` is unset when mail is on.
- A `vars` change only takes effect after `pnpm cf:deploy`.

Do **not** set a `Reply-To` pointing back at a no-reply address. With
`notifications@` as the From, replies should reach a human (see receiving).

## Receiving (Cloudflare Email Routing)

- Enable Email Routing on `pagepin.ai`; Cloudflare auto-provisions the root MX +
  its SPF record. Accept those.
- Add a forwarding rule per role address — `notifications@`, `legal@`, `abuse@`,
  `security@`, `social@` → the shared inbox.
- Turn on **catch-all** → same inbox, so mail to an address you forgot to wire up
  is never silently dropped.
- For programmatic handling later (e.g. "reply to a notification → append a
  pagepin comment"), Email Routing can route an address to a Worker instead of an
  inbox. That is also the only case where Resend **Inbound** would make sense —
  on a dedicated subdomain such as `reply@inbound.pagepin.ai`, never the root.

## DNS & coexistence

Sending and receiving share `pagepin.ai` without conflict because MX is
per-hostname:

| Host | Record | Owner | Notes |
| --- | --- | --- | --- |
| `pagepin.ai` (root) | `MX` | Cloudflare Email Routing | Inbound forwarding. Auto-added on enable. |
| `send.pagepin.ai` (or Resend's subdomain) | `MX` + SPF `TXT` | Resend | Return-path / bounces. Use the exact records Resend shows. |
| `resend._domainkey.pagepin.ai` | `TXT` (DKIM) | Resend | Use the exact key from the Resend dashboard. |
| `_dmarc.pagepin.ai` | `TXT` (DMARC) | you | See below. |

Hard rule: **never enable Resend Inbound on the root** `pagepin.ai`. It would claim
the root MX by priority and fight Cloudflare Email Routing. Sending from the root
is fine (Resend's return-path lives on the `send.` subdomain); only *inbound* MX
must have a single owner per host.

Keep SPF separate per host — Cloudflare's `v=spf1 include:_spf.mx.cloudflare.net …`
on the root, Resend's `include:amazonses.com …` on the `send.` subdomain. Do not
merge them; there is only one SPF record allowed per hostname.

### DMARC

Required by Gmail/Yahoo/Microsoft for bulk senders, and it clears Resend's
"Include valid DMARC record" warning. It passes here via **DKIM alignment**
(Resend signs `d=pagepin.ai`); SPF aligns too because the return-path
`send.pagepin.ai` is a subdomain of the From domain under relaxed alignment.

Start in monitor mode and ramp — do **not** begin at `p=reject`:

```
Host:  _dmarc
Type:  TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@pagepin.ai
```

1. `p=none` for ~1–2 weeks; confirm legitimate Resend mail reports 100% pass.
2. `p=quarantine`.
3. `p=reject`.

Reports are machine-readable XML. Either route `dmarc@pagepin.ai` via Email Routing
and skim, or use **Cloudflare DMARC Management** (parses reports into a dashboard,
no inbox noise) — the low-effort option since DNS is already on Cloudflare. `rua`
on the same domain needs no external-domain authorization.

## Runbook

**Change the From address**
1. Edit `PAGEPIN_MAIL_FROM` in `wrangler.jsonc` (and the Node env if used).
2. Ensure the new localpart has a Cloudflare Email Routing rule (else replies
   hard-bounce).
3. `pnpm cf:deploy`.
4. Update the [address inventory](#address-inventory-single-source-of-truth).

**Add a new public address**
1. Add it to the inventory table here.
2. Add a Cloudflare Email Routing forward rule.
3. Only then reference it in `pagepin-site` or anywhere user-facing.

**Status / open items**
- [x] `PAGEPIN_MAIL_FROM` → `notifications@pagepin.ai` (`wrangler.jsonc`, committed)
- [ ] `pnpm cf:deploy` to apply the From change — **still pending**
- [x] Email Routing live — root MX `route1/2/3.mx.cloudflare.net` published; rules for `social@` / `security@` / `abuse@` / `legal@` + catch-all → `fivesmallq@gmail.com` (destination verified). `notifications@` is covered by the catch-all (add an explicit rule if you ever disable catch-all).
- [x] DMARC published — `_dmarc.pagepin.ai` TXT `v=DMARC1; p=none; rua=mailto:dmarc@pagepin.ai`. Ramp `none` → `quarantine` → `reject` after monitoring reports.
- [x] `social@pagepin.ai` rule (for the X account)
