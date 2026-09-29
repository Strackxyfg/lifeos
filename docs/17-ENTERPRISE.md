# Enterprise: verified domains, single sign-on, provisioning

What a company needs before it lets LifeOS near its people: they sign in with
the company's identity provider, the company's directory decides who is in the
team (and who is not, the moment they leave), and a data processing agreement
says what happens to the data (see [`legal/`](legal/)).

Everything here belongs to a **company team** (kind `company`) and is changed by
its **owner**; admins see it. The database is the boundary — migration
`014_enterprise.sql` — not the page.

> **Status.** Migration 014 is validated on Postgres (PGlite: 114 checks, plus
> the 012 and 013 scenarios re-run on top of it). SCIM is tested end to end on
> the file store and was exercised over HTTP on the local demo. **SAML sign-in
> has not been run against a real identity provider**: it needs a Supabase
> project with SAML 2.0 enabled. The first real sign-in should be watched (see
> "First sign-in checklist").

---

## 1. Apply migration 014

Run `supabase/migrations/014_enterprise.sql` in the SQL editor, after 012 and
013. It is idempotent. Until it runs, the team page's *Enterprise* tab says so,
and `/auth/callback` signs people in without joining any team.

It adds:

| Table | What | Who writes |
|---|---|---|
| `lifeos_team_domains` | Domains a team claims, with a random token; `verified_at` | claim: owner (function); verify: server, after reading DNS |
| `lifeos_team_sso` | The Supabase SAML provider a team trusts; `jit`, `enforce` | link: server, after registering the provider; options: owner |
| `lifeos_scim_tokens` | SHA-256 of provisioning tokens (shown once) | owner (function), max 5 live |
| `lifeos_team_directory` | The roster SCIM pushes (userName, names, email, title, active, linked account) | SCIM endpoint only (service role) |
| `lifeos_team_groups`, `lifeos_team_group_members` | Groups SCIM pushes; `role` = what membership grants | SCIM (groups), owner (`role`) |

And two columns on `lifeos_team_members`: `via_sso` (joined through the
provider) and `admin_by_directory` (an admin because a directory group says so).

It also replaces six functions of 012/013 so that **requiring single sign-on
holds in the database**: `lifeos_team_role` / `lifeos_is_member` (asked by every
team policy), `lifeos_invite_preview`, `lifeos_accept_invite`,
`lifeos_set_member_role`, `lifeos_remove_member`, `lifeos_pin_team_note`,
`lifeos_forget_me`.

## 2. Verify a domain

*Team → Enterprise → Verified domains → Add.* LifeOS shows a TXT record:

```
_lifeos-challenge.acme.com   TXT   "lifeos-domain-verification=<32 hex characters>"
```

Publish it at the DNS provider, then *Verify now*. The server reads it
(`node:dns`, split TXT strings joined) and only then marks the domain verified.
Public mailbox domains (gmail.com, outlook.com, orange.fr, skynet.be…) cannot be
claimed. A verified domain belongs to one team; up to 20 claims per team. The
record may be removed once verified.

## 3. Single sign-on (SAML 2.0)

### In Supabase (once, by whoever runs LifeOS)

1. **Authentication → Providers → SAML 2.0: enable it.** Check the project's
   plan includes it. Without it, connecting a provider answers *"Single sign-on
   is not available here"* — nothing is faked.
2. **Authentication → URL Configuration → Redirect URLs:** add
   `https://<your LifeOS domain>/auth/callback`. Supabase refuses to send people
   anywhere else (it falls back to the Site URL).
3. `NEXT_PUBLIC_APP_URL` must be the public address of LifeOS: it builds that
   return address and the SCIM URL shown to owners.

### In the company's identity provider

The Enterprise tab shows the three values (they are Supabase Auth's own SAML
endpoints, derived from `NEXT_PUBLIC_SUPABASE_URL`):

| Field | Value |
|---|---|
| Identifier (Entity ID) | `https://<project>.supabase.co/auth/v1/sso/saml/metadata` |
| Reply URL (ACS) | `https://<project>.supabase.co/auth/v1/sso/saml/acs` |
| Metadata | `https://<project>.supabase.co/auth/v1/sso/saml/metadata?download=true` |
| Name ID | the user's email address |

- **Microsoft Entra ID:** Enterprise applications → New application → *Create
  your own* → SAML. Basic SAML configuration: the Entity ID and Reply URL above.
  Copy the *App Federation Metadata Url*.
- **Okta:** Applications → Create App Integration → SAML 2.0. *Single sign-on
  URL* = Reply URL, *Audience URI* = Entity ID, *Name ID format* =
  EmailAddress. Copy the *Metadata URL*.

### In LifeOS

*Enterprise → Single sign-on:* paste the metadata URL (https only) or the XML,
*Connect*. The server registers the provider with Supabase Auth
(`POST /auth/v1/admin/sso/providers`, service role) with the team's verified
domains, and only then links it to the team. If linking fails, the provider is
deleted again. *Update the metadata* (a rotated certificate) keeps the same
provider and the owner's options. Verifying or removing a domain updates the
provider's domains. Deleting the team deletes the provider.

People then sign in at `/login/sso` (also linked from `/login`) with their work
address: only its **domain** is sent to Supabase, which redirects to the
company's sign-in page. They come back to `/auth/callback`, where the code
becomes a session (PKCE) and Postgres decides whether they join
(`lifeos_sso_join`, from the signed token — nothing in the request counts):

1. **A directory entry for their address** (SCIM): it is linked to the account,
   and the directory decides — active → member (role from groups), inactive →
   not let in (*deprovisioned*).
2. **No entry, "just in time" on** (the default): an address at one of the
   team's **verified** domains joins as a member.
3. Otherwise: not let in (*not provisioned*). Seats always hold (*full*).

A failure lands on `/team?sso=<reason>` with a sentence saying why.

**Accounts.** Supabase keeps a single sign-on account apart from a password
account with the same address: they are two accounts. Someone who had joined by
invitation with a password and then signs in with SSO has a second, SSO account
(which joins by the rules above). The members list marks who joined with SSO.

### Requiring single sign-on

With *Require single sign-on* on, a member whose session did not come through
the team's provider **is not a member** of it: every team policy asks
`lifeos_team_role`, which checks the token's `amr` claim (`sso/saml` with this
provider's id, or an SSO-only account's `app_metadata.provider = sso:<id>`).
Invitations are refused (`sso`) unless accepted through the provider. Leaving
stays possible.

**The owner is the exception**, whatever the sign-in: a team can never be
locked out of itself (break-glass). Hand ownership to the SSO account once it
exists if the owner must use SSO too.

### First sign-in checklist

On the first real SAML sign-in, check (Supabase → Authentication → Users, and
the team's Members tab):

- the user is created as an SSO user and lands on the team;
- in a decoded access token, `amr` contains `{"method":"sso/saml","provider":"<id>"}`
  and `app_metadata.provider` is `sso:<id>` — LifeOS reads both, and the
  requirement depends on them;
- with *Require single sign-on* on, a password session of another member no
  longer sees the team, and the owner still does.

## 4. Automatic provisioning (SCIM 2.0)

*Enterprise → Automatic provisioning:* create a token (shown once; LifeOS keeps
its SHA-256), copy the tenant URL `https://<LifeOS>/api/scim/v2`.

- **Microsoft Entra ID:** the enterprise application → Provisioning →
  *Automatic*. Tenant URL and Secret Token as above → *Test Connection*.
  Mappings: `userPrincipalName` (or `mail`) → `userName`,
  `Switch([IsSoftDeleted], , "False", "True", "True", "False")` → `active`,
  `objectId` → `externalId`, names and job title as offered. Provision groups if
  roles should follow them.
- **Okta:** the app → General → App Settings → *Provisioning: SCIM*, then the Provisioning tab. SCIM connector base URL = tenant URL,
  unique identifier field = `userName`, supported actions: push new users,
  profile updates, groups; authentication mode *HTTP Header*, Bearer = the token.
  To App: create, update attributes, deactivate.

What the endpoint does:

| | |
|---|---|
| Resources | `Users`, `Groups` (GET, POST, PUT, PATCH, DELETE); `ServiceProviderConfig`, `ResourceTypes`, `Schemas` |
| Filters | `eq ne co sw ew gt ge lt le pr`, `and or not`, value paths (`emails[type eq "work"]`, `members[value eq "…"]`); `userName` and `externalId` eq go straight to the store |
| PATCH | Entra's and Okta's shapes (`"Replace"`, `"False"`, path-less values, dotted keys, members by list or filter) |
| Not supported | Bulk, sorting, ETags, `/Me`, passwords (answered 501 / ignored) |
| Ignored | attributes LifeOS does not keep (phones, addresses, enterprise extension) — refusing them would fail the provider's whole sync |
| Limits | 1 MB per request, 200 per page, 10,000 members per group, 5 live tokens per team |

**What provisioning does to the team** (Postgres triggers, so it holds whoever
writes):

- An entry is **linked** to an account the first time that person signs in with
  SSO; from then on the directory decides. Deactivated (`active` false) or
  deleted → **out of the team at once**, their anonymous pulse answers with
  them. Reactivated → back in, if a seat is free.
- The provider's groups grant nothing until the owner says so: *Grants → Admin*
  on a group makes its (linked) members admins; leaving every such group takes
  that admin role back — **only an admin the directory made**. A role someone
  chose by hand is left alone.
- The **owner is never touched** by provisioning.
- Entries do not take seats; members do. Provisioning more people than seats is
  accepted (the provider would otherwise quarantine its sync); the ones beyond
  wait for a seat at sign-in, and the owner sees the counts.
- What a person keeps in their own brain is theirs: provisioning never reads
  it, and removing them from the team does not delete it.

In the file store (no Supabase), there is no SAML: an entry is linked to the
member whose address it carries, which lets the whole provisioning flow run
locally.

## 5. What is not there yet

- An **audit log** of who changed what (settings, roles, provisioning).
- **SAML single logout**, and revoking live sessions of someone deprovisioned
  (their team access ends at once through the database; their session itself
  lives until it expires).
- **OIDC** providers (Supabase Auth's SSO is SAML).
- Per-seat **billing** of company teams (seats exist; their price is a
  decision to make).
- An external **penetration test** and any certification (SOC 2, ISO 27001).
