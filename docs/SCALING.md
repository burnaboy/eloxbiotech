# Scaling: how many members the app can handle

**Short answer:** the code and database design hold up at 100,000+ members (load-tested below). How many people
can use the site *at the same time* depends on how many web servers you run, and that is a hosting setting you
can turn up without code changes.

## What was tested (8 November 2026)

A synthetic network of **100,000 members** in a realistic tree (random sponsors, spillover to the outside edge,
deepest member at level 283, average level 41), one matured order per member, **4.2 million volume ledger rows**,
about 800 MB of data. PostgreSQL 16 and the production build of the app on one 4-CPU test machine.

### Pages (single request, database time included)

| What | Typical time |
| --- | --- |
| Member dashboard overview (any member) | 3–6 ms |
| Volume summary, ordinary member | 2–8 ms |
| Volume summary, company root (whole network below it) | ~130 ms |
| Tree view, 3 levels, any member | 2–4 ms |
| Network search (whole network, or inside a downline) | 2–10 ms |
| Admin member search ("name contains …") | ~3 ms |
| Wallet balance | <1 ms |

### Many visitors at once (50 simultaneous connections for 20 s, one app process)

| Page | Throughput | Median response |
| --- | --- | --- |
| Home page | ~90 pages/s | 0.53 s |
| Member dashboard (signed in) | ~48 pages/s | 1.0 s |
| Tree view (signed in) | ~80 pages/s | 0.6 s |

During these tests the **database used under 10% CPU; the app process was the limit** (rendering pages). So the way
to serve more people at once is more web instances, not a bigger database. The app keeps no state in memory
(sessions, rate limits, locks and jobs are all in PostgreSQL), so extra instances work straight away.

Rule of thumb: one 1-CPU web instance serves roughly **40–90 page views a second**, which is about
**500–1,000 members actively clicking around at the same moment**. Two instances double that.

### Scheduled jobs at 100,000 members

| Job | Before this change | After |
| --- | --- | --- |
| Binary pairing (every member with carry, qualification checked) | **Failed** after the 120 s transaction limit, and paid nobody | **97 s**, 683,717 pairs paid, ledger and volume reconcile with 0 issues |
| Mature orders | Loaded every paid order still in its refund window, every hour | Loads only orders old enough to be due, 500 at a time |
| Reconcile ledger | 0.1 s | 0.1 s |
| Reconcile volume | 15 s | 15 s |
| Send emails | 100 per minute, one at a time (6,000 an hour) | Up to 2,000 per minute, 4 at a time |

## What changed in the code

- **Binary pairing runs in batches** of 500 members, each batch in its own transaction. If a run is cut off
  (deploy, crash, timeout) calling it again for the same day carries on where it stopped and never pays anyone
  twice: a member already handled in that run is skipped, and two overlapping calls take turns batch by batch.
  Qualification ("a personal referral on each leg") is worked out for the whole batch in one query instead of three
  queries per member. A run is only marked finished (`BinaryRun.completedAt`) when every member is done.
- **Order maturing** reads in pages and skips orders that can't be due yet; plan versions are read once per run.
- **Emails** go out 4 at a time until the queue is empty or 45 seconds pass (the job runs every minute).
- **Database connection pool** is set with `DB_POOL_SIZE` (and `DB_POOL_TIMEOUT`). Prisma's default is only
  3 connections on a 1-CPU server, so a few slow requests made everyone else wait. `render.yaml` sets 10 for
  production and 5 for staging.
- **Brand and shop settings** (read on nearly every page) are kept in memory for 10 seconds per instance. Admin
  edits, transactions and emergency switches always read the database directly.
- **New indexes:** trigram indexes for "name/email contains" searches, sponsor sales by date, and binary
  commissions by run.

## Hosting steps to take as the network grows

These change the monthly bill, so they are your call. Prices are from `docs/HOSTING.md`; check render.com/pricing.

| Members (roughly) | Web | Database | Notes |
| --- | --- | --- | --- |
| Up to ~20,000 | 1 × `1c-2g` (current) | `0.5c-1g` (current) | Fine as it is |
| 20,000–100,000 | 2 instances (set *Instances* to 2 on `elox-prod-web`), or autoscaling 2–4 at 70% CPU (Professional workspace) | `1c-2g` or larger, for more memory to cache the tree and ledger | Two instances also means no downtime if one restarts |
| 100,000+ | Autoscaling 2–6 instances | `2c-4g`+, with a read replica for reports if admin reports get slow | Put a CDN (Cloudflare) in front for images and static files |

Keep `instances × DB_POOL_SIZE + 10` below the database's connection limit (check it on the database's *Info* page in
Render). With 10 per instance, 6 instances use about 70 connections.

## Limits to know about

- **Very lopsided trees.** Each member stores the list of everyone above them, and each matured order writes one
  volume row per upline member. With realistic trees (average level ~40) this is cheap. If almost everyone were
  placed in one long chain (thousands of levels), orders would get slower to mature and the volume table would grow
  fast. Check the deepest level now and then (`SELECT max(depth) FROM "AffiliateNode"`); if it passes a few thousand, plan a review.
- **Binary run length** grows with the number of members who have carry: about 1 second per 1,000 members on the
  test machine. The scheduler allows 15 minutes; a run that is cut off simply resumes when called again (the admin
  *Run binary* button does that too).
- **The company root's volume summary** (~130 ms) grows with the whole network. It is only on the root account's
  dashboard and admin pages.
- **Email** at 2,000 a minute depends on the email provider's own rate limits once one is connected.

## Re-running the load test

`docs/SCALING.md` numbers came from a throwaway database filled by a script (users, tree, orders and volume via
`COPY`), the production build (`npm run build`, `node .next/standalone/server.js`) and `npx autocannon -c 50 -d 20`.
Never point a load test at production.
