# Database design and performance

PostgreSQL 16 through Prisma. Money is integer kobo; volume is integer PV. Schema: `prisma/schema.prisma`; every change is a migration in `prisma/migrations`.

## Business rules the database enforces

The application checks these too, but the database is the last line, so a bug or a race can't break them.

| Invariant | How |
| --- | --- |
| One account per email, one referral code each | Unique `User.email`, `User.referralCode` |
| One position per affiliate; each position has at most one left and one right child | Unique `AffiliateNode.userId`; unique `(parentId, position)` |
| Placement can't be changed after the fact; no node is its own ancestor | Trigger on `AffiliateNode` blocking changes to parent, position, ancestry; CHECK `AffiliateNode_no_self_ancestor` |
| A payment reference is used once; a webhook event is processed once | Unique `Payment.providerRef`; unique `WebhookEvent(provider, eventId)` |
| An order is paid by one payment; a checkout makes one order | Unique `Order.paidPaymentId`; unique `Order.checkoutKey` |
| One direct commission per order per member | Unique `Commission(userId, type, orderId)` |
| A binary period is paid once | Unique `BinaryRun.periodKey` |
| Ledger postings happen once and are never edited | Unique `LedgerEntry.idempotencyKey`; trigger blocks UPDATE/DELETE; CHECK on amounts and buckets |
| Audit log is append-only and hash-chained | Trigger allows only the sealing update; unique `chainPos` |
| One open withdrawal per member; one active bank account per member | Partial unique indexes `Payout_one_open_per_member`, `PayoutAccount_one_active` |
| A withdrawal is "paid" only with evidence; a transfer reference can't be reused | CHECK `Payout_paid_has_evidence`; unique `Payout.reference`, `Payout.requestKey` |
| Stock never goes negative | Conditional atomic updates inside the order transaction, plus CHECK constraints on stock |
| Financial records can't be deleted from under their ledger | Ledger foreign keys `ON DELETE RESTRICT` |

Multi-step changes (checkout, payment confirmation, refunds, maturing commissions, withdrawals, placement) each run in one transaction. Concurrent writers to the same member's wallet or the same order are serialised with row locks (`SELECT … FOR UPDATE`) or advisory locks keyed by the member or order.

## Indexes

Frequently queried fields from the requirements, and the index that serves each:

| Query | Index |
| --- | --- |
| Sign-in by email | `User.email` (unique) |
| Referral link lookup | `User.referralCode` (unique) |
| A member's referrals | `User(sponsorId)` |
| Member lists by join date / role | `User(createdAt)`, `User(role, status)` |
| Children of a position, by leg | `AffiliateNode(parentId, position)` (unique), `AffiliateNode(parentId)` |
| Everyone under a position | GIN on `AffiliateNode.ancestorIds` |
| Order lists and filters | `Order(status, createdAt)`, `Order(createdAt)`, `Order(status, paidAt)`, `Order(userId)`, `Order(referrerId)` |
| Expiring unpaid orders (job) | `Order(status, expiresAt)` |
| Maturing paid orders (job) | `Order(commissionedAt, paidAt)` |
| Payment by reference | `Payment.providerRef` (unique) |
| Stale pending payments (job) | `Payment(status, createdAt)` |
| A member's commissions | `Commission(userId, createdAt)` |
| Commission lists by status/date | `Commission(status, createdAt)`, `Commission(createdAt)` |
| Ledger by member, source, payout, type, date | `LedgerEntry(userId, createdAt)`, `(sourceType, sourceId)`, `(payoutId)`, `(commissionId)`, `(type, createdAt)`, `(createdAt)`, unique `idempotencyKey` |
| Withdrawal queues and history | `Payout(status, createdAt)`, `Payout(userId, status)`, `Payout(batchId)`, `Payout(settledAt)` |
| Email queue (job) | `EmailOutbox(sentAt, createdAt)` |
| Rate limits and sign-in throttling | `LoginAttempt(key, createdAt)` |

## Pagination

Admin and member lists are paged (50–100 rows, `skip`/`take` with one extra row to know if there's a next page) and filtered by date range. Reports are bounded by a date range (default 30 days). CSV exports are capped at 50,000 rows. For very large tables later, switch the busiest lists (orders, ledger, audit) to keyset pagination on `(createdAt, id)`; the indexes above already support it.

## Network tree strategy: materialised path

Each `AffiliateNode` stores `ancestorIds`: the ids of every node above it, root first, plus `depth`, `parentId` and `position`.

- **Ancestors of a node** (to add volume up the tree, or count members on each side): read from the node's own row. No query per level.
- **Descendants of a node** ("everyone in my downline", search within my team): `ancestorIds @> ARRAY[nodeId]`, served by the GIN index. Combined with `depth <= d + n` to load only the next few levels for the tree view.
- **Which side of me is a descendant on**: the element after my id in their `ancestorIds`, compared with my direct children's positions.
- **Spillover placement** (bottom of a leg's outside edge): one recursive CTE that follows `(parentId, position)` down the edge, rather than one query per level.
- **Leg totals** (`leftCount`, `rightCount`, `leftTotalPv`, `rightTotalPv`, carry): stored on each node and updated in the same transaction as the event, with one `UPDATE … WHERE id IN (ancestors)` per side. Dashboard reads are a single row.

**Why this over the alternatives**

| Option | Reads | Writes | Notes |
| --- | --- | --- | --- |
| Recursive CTE on `parentId` only | Every ancestor/descendant query walks the tree at query time; cost grows with depth | Cheap | Fine for small trees; slow for deep binary trees, which grow deep fast through spillover |
| Closure table (one row per ancestor–descendant pair) | Fast, indexable | Inserting a member at depth *d* writes *d* rows; table grows to n × average depth | More rows and joins for the same answers |
| **Materialised path array (chosen)** | Ancestors free from one row; descendants via GIN index | One row per member; ancestry copied from the parent at insert | Path length equals depth; works because placement is permanent, so paths never need rewriting |

Trade-offs accepted: rows get larger as the tree deepens (a 36-character id per level), and a GIN index costs some write time. Moving a node would need rewriting all its descendants' paths, which is why placement is permanent and enforced by a trigger. If the tree ever reaches depths in the thousands, the stored per-node totals keep dashboards fast, and the descendant queries stay bounded by depth limits and page sizes.

## Reproducible calculations

- **Plan versions** are immutable rows. Each order stores the version in force when it was paid; its commissions store the version id, base amount, rate and inputs, so any commission can be recomputed exactly.
- **Volume** is an append-only ledger (`VolumeEntry`) per order and node; node totals are a cache of it. The volume reconciliation job recomputes every node from the ledger and reports differences.
- **Binary runs** record the period, pairs and amounts; carry changes are recorded as `CarryMovement` rows linked to the run.
- **Wallet balances** are always derived from `LedgerEntry`; the wallet reconciliation job checks them against commissions and withdrawals daily.

## Background jobs

Run by the scheduler through `POST /api/cron/<job>` with the `CRON_SECRET`. Each run is recorded and shown on *Admin → System health*.

| Job | Every | What |
| --- | --- | --- |
| `send-emails` | 1 min | Sends queued emails (notifications write to the outbox, never send inline) |
| `expire-orders` | 5 min | Cancels unpaid orders past their hold time and releases stock |
| `reconcile-payments` | 10 min | Re-checks pending payments with Paystack |
| `seal-audit` | 10 min | Links new audit records into the hash chain |
| `mature-orders` | hourly | Approves commissions and credits volume after the return window |
| `refresh-prices` | hourly | Sale prices that started or ended |
| `binary` | daily | Binary run for the previous day (skipped while binary pay is off) |
| `reconcile-ledger`, `reconcile-volume` | daily | Integrity checks; report only, never change data |
| `cleanup` | daily | Expired sessions, old sign-in attempts |

Reports are computed on request from indexed, date-bounded queries; at larger scale, the revenue report can be backed by a nightly summary table.
