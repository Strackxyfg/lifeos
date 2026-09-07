# Growth, SEO & Launch — LifeOS AI

## Growth strategy

### The wedge

LifeOS's unfair advantage is **time-to-wow**: a real, personalized workspace in 60 seconds.
That is inherently demoable and shareable. Growth compounds three loops:

**1. The "watch it build" loop (activation → word of mouth)**
The generation moment is the product's marketing. Instrument it, make it screen-recordable,
and add a one-tap "Share my workspace" that produces a clean, branded before/after.

**2. Native-Notion virality (distribution)**
Output is native Notion with no lock-in. Every generated workspace carries a subtle
"Built with LifeOS" footer on the Home page (removable on paid). Notion is a sharing-native
tool — templates and workspaces get duplicated and passed around. We ride that.

**3. Template-to-product SEO loop (acquisition)**
Publish free, best-in-class Notion templates for each database (Projects, CRM, Finance…).
Each template page's CTA: "Want this *personalized* and wired together automatically? →
Generate your LifeOS." Free template captures the search; the product captures the upgrade.

### Funnel & targets

| Stage | Metric | Target (M6) |
|---|---|---|
| Visit → signup | signup rate | 8% |
| Signup → generated | activation | 70% |
| Generated → W4 retained | retention | 40% |
| Free → paid | conversion | 6% |
| Paid → referral | K-factor | 0.4 |

### Channels (prioritized)

1. **Content/SEO** (compounding) — templates + "how to build X in Notion" + comparisons.
2. **Founder-led social** — build-in-public on X/LinkedIn; the generation clip is the hook.
3. **Communities** — Notion subreddit/Discords, Indie Hackers, r/productivity (value-first).
4. **Creators** — Notion/productivity YouTubers; affiliate on annual plans.
5. **Product Hunt + Hacker News** — launch spikes (see below).
6. **Lifecycle** — the weekly review email *is* retention and a re-engagement surface.

### Pricing-led growth

Free trial (14d, no card up front converts more top-of-funnel; card-required converts
higher-intent — A/B this). Annual = 2 months free. Founder tier anchors value; Pro is the
default. Reverse-trial experiment: full features for 7 days, then Starter.

### Retention & expansion

- **Ritual, not tool:** weekly AI review + daily summary create a standing reason to return.
- **Expansion:** solo → team (Founder) as the account grows; usage-based generation add-ons.
- **Save-churn:** at cancel, offer pause + a downgrade to Starter, not just "goodbye."

---

## SEO strategy

Implemented hooks in-repo: [`../app/robots.ts`](../app/robots.ts),
[`../app/sitemap.ts`](../app/sitemap.ts), rich metadata + OG in
[`../app/layout.tsx`](../app/layout.tsx), semantic headings, fast static marketing pages.

### Technical SEO (foundation ✅ / planned ⬜)

- ✅ Static-rendered marketing (fast LCP), metadata/OG/Twitter, robots, sitemap, theme-color.
- ✅ App routes disallowed in robots (no thin/auth pages indexed).
- ⬜ Per-template/blog `generateMetadata`, canonical URLs, JSON-LD (`SoftwareApplication`, `FAQPage`, `BreadcrumbList`).
- ⬜ Dynamic OG images (`opengraph-image`), image `sitemap`, Core Web Vitals budget in CI.

### Content architecture (topical authority around "Notion + your life")

- **Templates hub** — one indexable page per database, each a genuinely useful free template.
- **Guides** — "How to build a [CRM/finance/second brain] in Notion" → converts to "or generate it."
- **Comparisons** — "LifeOS vs. [template marketplace]", "vs. hiring a Notion consultant."
- **Use-case pages** — for founders, freelancers, students (matches onboarding personas).
- **Programmatic** — "[profession] Notion setup" pages generated from the blueprint taxonomy.

### Keyword clusters

Primary: *notion workspace generator, ai notion setup, notion template for [x], personal
operating system, notion second brain*. Long-tail via programmatic profession/use-case pages.

### Measurement

GSC + Ahrefs; track cluster rankings, template→signup rate, and assisted conversions from
organic. North star for SEO: organic signups/week.

---

## Launch strategy

### Pre-launch (waitlist warm-up, 4–6 weeks)

- Waitlist live (built) with referral positions ("skip the line"). Target 5k emails.
- Build-in-public cadence: 2–3 generation clips/week; share the roadmap openly.
- Seed 20–30 design-partner founders; collect the testimonials that anchor the site.
- Prime creators + communities with early access; line up launch-day quotes.

### Launch week

- **Day 1 — Product Hunt.** Ship a 30-sec "watch it build" video as the hero asset. Mobilize
  waitlist + design partners for first-hour momentum. Founder in comments all day. Launch-day code.
- **Day 2 — Hacker News** ("Show HN: I built a tool that generates a personalized Notion
  workspace in 60s"). Technical, humble, engineering-forward (the two-pass relation build is
  a genuinely interesting story). Respond to every thread.
- **Day 3–5 — Social + creators.** Coordinated X/LinkedIn threads; creators publish; repost UGC.
- **Throughout** — a live public metrics counter (workspaces generated) for social proof.

### Launch assets

Landing page ✅ · 30-sec generation demo · 3 testimonial cards ✅ (content) · comparison page ·
5 seeded free templates · press/one-pager · founder thread.

### Post-launch (0→90 days)

- Turn launch traffic into content: publish the templates people asked for.
- Weekly ship notes (changelog) to keep momentum and give creators reasons to re-cover.
- Instrument activation ruthlessly; the single biggest lever is generated→retained.
- Begin annual-plan push + creator affiliates once retention proves out.

### Success criteria

Launch week: #1–3 Product Hunt, 3–5k signups, >65% activation. Day-90: >1k paying, W4
retention >40%, CAC payback < 3 months on paid channels.
