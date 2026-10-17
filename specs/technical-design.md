# Seereon Delivery Board: Technical Design and Debt Register

Sep 28, 2026 · @Santosh

Every buildable item in Release 1 and 1.1 has an ID, and each ID is one pull request that a developer can pick up, build and close. This tab is the design; the Debt register tab lists what the prototype and the release plan leave to be paid back. It builds on the BRD/FSD (BR-xx, F-xxx) and the Technical Build Plan (WBS task numbers).

## 1. Conventions

Every deliverable below follows these rules. A reviewer rejects a PR that breaks one.

**Deliverable IDs**

| Prefix | Deliverable | One item equals |
| --- | --- | --- |
| DB | Database table | One Alembic migration: table, constraints, indexes, RLS policy, SQLAlchemy model |
| API | Endpoint | One route with Pydantic request/response schemas, permission check, tests |
| SVC | Domain service | One pure Python function or class in `app/domain/`, with unit tests |
| JOB | Background job | One Celery task + beat schedule entry, idempotent, with a test |
| UI | Screen | One React route: page component, data hooks, loading/empty/error states |
| CMP | Shared component | One reusable React component with a Storybook-style example and a test |
| NTF | Notification | One event type: in-app payload + email template |
| TST | Test suite | One suite that runs in CI |
| OPS | DevOps item | One infrastructure or pipeline change |

Each row also carries its WBS task number from the Technical Build Plan, so the PM can roll items up to tasks.

**Naming**

- Tables: `snake_case`, plural (`timesheet_weeks`). Columns: `snake_case`. Foreign keys: `<table_singular>_id`.
- API paths: `/api/v1/<plural-resource>`, kebab-case, nouns only; actions as sub-resources (`POST /timesheet-weeks/{id}/submit`).
- Python: modules `snake_case`, classes `PascalCase`. React: components `PascalCase.tsx`, hooks `useThing.ts`.

**API rules**

- JSON only. Auth by `Authorization: Bearer <access token>`; refresh token in an httpOnly, Secure, SameSite=Strict cookie.
- List endpoints take `?page=&page_size=` (default 50, max 200) and `?sort=`; they return `{items, total, page, page_size}`.
- Errors always return `{"error": {"code": "TS_LOCKED", "message": "...", "field": "..."}}` with the right HTTP status (400 validation, 401 auth, 403 permission, 404 not found, 409 conflict or rule breach, 422 schema).
- Every write takes `If-Match: <version>` and returns 409 `STALE` if the row changed. The prototype had last-write-wins; this closes it.
- Rule breaches name the rule: code `BR_17_REASON_REQUIRED`, message in plain words.

**Data rules**

- Money: `BIGINT` paise. Never float. Display formats in the frontend only.
- Dates: `DATE` for calendar facts (work date, due date); `TIMESTAMPTZ` in UTC for events. Tenant time zone (default Asia/Kolkata) is applied in services and jobs, never in the browser.
- Every tenant table has `tenant_id UUID NOT NULL` + RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`.
- Soft delete only where stated (`deleted_at`); everything else is a hard delete with an activity-log row.

**Definition of done for any item**

1. Code merged to `main` through a reviewed PR that names the item ID.
2. Tests for the item pass in CI, including the cross-tenant suite.
3. OpenAPI schema updated (API items) and the frontend client regenerated.
4. Shown working on local staging to the PM.

## 2. Architecture

&#91;embedded content: architecture · 8 components, local and AWS\]

The browser talks only to the API. The API never sends email or runs long work itself: it writes the row, enqueues a job, and returns. The worker holds all scheduled logic (weekly lock, SLA checks, milestone sweep), which the prototype ran inside the browser.

## 3. Repository layout

One monorepo, two apps. Business rules live only in `api/app/domain/`; routes call domain functions and never compute money or dates themselves.

```
seereon-board/
├─ docker-compose.yml          # postgres, redis, mailpit, minio, api, worker, beat, web
├─ .github/workflows/ci.yml    # lint, tests, build
├─ infra/terraform/            # M9 only: vpc, rds, redis, s3, ses, ecs, cloudfront
├─ api/
│  ├─ alembic/versions/        # one migration per DB-xx item
│  ├─ app/
│  │  ├─ main.py               # FastAPI app, middleware, router mount
│  │  ├─ core/                 # config, db session, tenant context, security, errors, pagination
│  │  ├─ models/               # SQLAlchemy models, one file per table group
│  │  ├─ schemas/              # Pydantic request/response models
│  │  ├─ routers/              # one file per resource: auth, users, projects, tasks, timesheets...
│  │  ├─ domain/               # SVC-xx: calendar, timesheet_rules, costing, payroll, compensation
│  │  ├─ permissions/          # role map, grants, guards (API-level only)
│  │  ├─ jobs/                 # JOB-xx Celery tasks + beat schedule
│  │  ├─ notify/               # NTF-xx: event types, email templates (Jinja2)
│  │  └─ integrations/         # razorpay, s3, email provider
│  └─ tests/
│     ├─ unit/                 # domain rules, one test file per BR group
│     ├─ api/                  # route tests incl. permission matrix
│     └─ tenancy/              # cross-tenant suite (auto-discovers every route)
└─ web/
   ├─ src/
   │  ├─ api/                  # generated OpenAPI client + TanStack Query hooks
   │  ├─ app/                  # router, layout shell, auth provider, role menu
   │  ├─ components/           # CMP-xx shared components
   │  ├─ features/             # UI-xx screens grouped: auth, people, projects, tasks, timesheet...
   │  ├─ lib/                  # formatting (₹, dates), constants, theme tokens
   │  └─ styles/
   └─ e2e/                     # Playwright specs (TST-E2E)
```

## 4. Database deliverables (DB)

34 migrations covering 36 tables. Every tenant table also has the common columns `id UUID PK`, `tenant_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `version INT` (for If-Match), and an RLS policy. Those are not repeated below. Money columns end in `_paise`.

| ID | Table | Columns (beyond common) | Constraints and indexes | WBS |
| --- | --- | --- | --- | --- |
| DB-01 | tenants | name, slug, status (trial / active / read\_only / suspended), trial\_ends\_on, time\_zone, settings JSONB | Global (no tenant\_id, no RLS); slug unique | 2.1 |
| DB-02 | plans | code, name, price\_per\_user\_paise, billing\_period, max\_users | Global; code unique | 2.1 |
| DB-03 | subscriptions | plan\_id, razorpay\_subscription\_id, status, current\_period\_end, seats | One active per tenant (partial unique) | 2.1 |
| DB-04 | users | email, password\_hash, name, role (admin / pm / sales / ops / employee), reports\_to\_id, grants JSONB, prefs JSONB, status, last\_login\_at | UNIQUE(tenant\_id, lower(email)); reports\_to not self | 2.1 |
| DB-05 | invites | email, role, reports\_to\_id, token\_hash, expires\_at, accepted\_at | token\_hash unique; expires 7 days | 2.1 |
| DB-06 | refresh\_tokens | user\_id, token\_hash, expires\_at, revoked\_at, user\_agent | token\_hash unique; index (user\_id) | 2.1 |
| DB-07 | holidays | date, name | UNIQUE(tenant\_id, date) | 3.2 |
| DB-08 | lookup\_values | kind (product / ledger\_category / ops\_category / lead\_source), value, sort, active | UNIQUE(tenant\_id, kind, value) | 3.5 |
| DB-09 | projects | code, name, client, type (product / service / saas / ams), status (initiated / active / on\_hold / npa / completed / closed), pm\_id, start\_on, end\_on, contract\_value\_paise, billing\_model, description | UNIQUE(tenant\_id, code); index (tenant\_id, status) | 4.1 |
| DB-10 | project\_status\_history | project\_id, from\_status, to\_status, reason, changed\_by, changed\_at | Append only (no UPDATE grant) | 4.1 |
| DB-11 | number\_sequences | scope (project / milestone:{project\_id} / task:{milestone\_id}), next\_value | UNIQUE(tenant\_id, scope); row lock on increment | 4.1 |
| DB-12 | milestones | project\_id, no, name, planned\_start, planned\_end, billing\_amount\_paise, billing\_status (none / invoiced / paid), empty\_since, deleted\_at | UNIQUE(project\_id, no); soft delete | 4.1 |
| DB-13 | tasks | project\_id, milestone\_id (nullable), no, title, owner\_id, backup\_id, est\_hours NUMERIC(6,1), start\_on, due\_on, complexity, status, description | UNIQUE(milestone\_id, no); index (tenant\_id, owner\_id, status) | 5.1 |
| DB-14 | task\_dependencies | task\_id, depends\_on\_task\_id | PK(task\_id, depends\_on\_task\_id); no self; cycle check in SVC-06 | 5.1 |
| DB-15 | comments | task\_id, body, mentions UUID\[\] | Index (task\_id, created\_at) | 5.4 |
| DB-16 | notifications | user\_id, type, payload JSONB, read\_at, emailed\_at | Index (user\_id, read\_at) | 5.4 |
| DB-17 | activity\_log | entity, entity\_id, action, before JSONB, after JSONB | Append only; index (entity, entity\_id) | 5.6 |
| DB-18 | timesheet\_weeks | user\_id, week\_start (Monday), status (open / submitted / approved / rejected / locked), submitted\_at, approver\_id, decided\_by, decided\_at, late BOOL, reject\_reason, unlock\_requested\_at, unlock\_reason, unlock\_until | UNIQUE(tenant\_id, user\_id, week\_start); CHECK week\_start is Monday | 6.1 |
| DB-19 | timesheet\_entries | week\_id, work\_date, kind (task / leave / internal), task\_id, internal\_code, hours NUMERIC(4,1), note | CHECK hours in 0.5 steps, 0 to 24; index (tenant\_id, task\_id) | 6.1 |
| DB-20 | leave | user\_id, date, type (paid / lwp), portion (full / half), source (timesheet / hr), approved\_by | UNIQUE(tenant\_id, user\_id, date) | 6.1 |
| DB-21 | delegations | from\_user\_id, to\_user\_id, from\_on, to\_on | CHECK from\_on <= to\_on | 6.1 |
| DB-22 | cost\_rates | user\_id, monthly\_ctc\_paise, variable\_pct, sales\_target\_paise, effective\_from | UNIQUE(user\_id, effective\_from); rows never updated | 7.1 |
| DB-23 | allocations | project\_id, milestone\_id, user\_id, pct, from\_on, to\_on | All NOT NULL (BR-22); CHECK pct 1 to 100 | 7.2 |
| DB-24 | files | key, name, mime, size\_bytes, entity, entity\_id | key unique | 7.4 |
| DB-25 | invoices | milestone\_id, number, invoiced\_on, amount\_paise, paid\_amount\_paise, paid\_on, file\_id | UNIQUE(tenant\_id, number) | 7.4 |
| DB-26 | payroll\_runs | month (first of month), status (draft / final), finalised\_by, finalised\_at | UNIQUE(tenant\_id, month) | 7.8 |
| DB-27 | payroll\_lines | run\_id, user\_id, base\_paise, working\_days, approved\_days, unapproved\_days, unapproved\_weeks DATE\[\], lwp\_days, deduction\_paise, variable\_paise, net\_paise | UNIQUE(run\_id, user\_id); frozen when run is final | 7.8 |
| DB-28 | deals | title, client, contact, phone, email, product, source, owner\_id, stage, value\_paise, mrr\_paise, expected\_close, won\_on, lost\_on, lost\_reason, project\_id | Index (tenant\_id, owner\_id, stage) | 10.1 |
| DB-29 | deal\_stage\_history | deal\_id, from\_stage, to\_stage, by, at | Append only | 10.1 |
| DB-30 | deal\_activities | deal\_id, date, type, note, by | Index (deal\_id, date) | 10.1 |
| DB-31 | ledger\_entries | kind (income / expense), category, amount\_paise, date, recurring BOOL, until\_on, status, project\_id, milestone\_id, note | Index (tenant\_id, date) | 11.1 |
| DB-32 | change\_requests, openings, ops\_items | CR: project\_id, title, hours, value\_paise, status. Opening: role, project\_id, count, status, owner\_id. Ops: item, category, owner\_id, due\_on, recurring, status | Three tables, one migration | 11.6 |
| DB-33 | daily\_updates | user\_id, date, done, proof\_url, blocker, demo\_shown | UNIQUE(tenant\_id, user\_id, date) | 12.2 |
| DB-34 | admin\_audit | actor\_id, tenant\_id, action, reason, at | Platform schema, no RLS; append only; index (tenant\_id, at) | 8.5 |

## 5. API deliverables (API)

All paths sit under `/api/v1`. Roles: **A** admin (CEO), **P** project manager, **S** sales, **O** operations, **E** employee, **Pub** no login, **SA** Seereon super admin. "Own" means rows the user owns or manages. Every endpoint also gets the cross-tenant test automatically.

### Auth and users (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-AUTH-01 | POST /auth/signup | Pub | Creates tenant, admin user and default settings in one transaction; starts trial; returns tokens | 2.2 |
| API-AUTH-02 | POST /auth/login | Pub | Email + password; 5 failures in 15 min locks the account for 15 min | 2.3 |
| API-AUTH-03 | POST /auth/refresh | Cookie | Rotates the refresh token; old one revoked | 2.3 |
| API-AUTH-04 | POST /auth/logout | Any | Revokes the refresh token | 2.3 |
| API-AUTH-05 | POST /auth/password-reset/request | Pub | Always 202, so emails cannot be probed; sends NTF-01 | 2.4 |
| API-AUTH-06 | POST /auth/password-reset/confirm | Pub | Token valid 60 min, single use | 2.4 |
| API-AUTH-07 | GET /me | Any | User, role, grants, tenant, plan status, allowed tabs | 2.7 |
| API-USR-01 | GET /users | A, P | Filter by role, status, reports\_to; P sees own reports only | 2.5 |
| API-USR-02 | POST /invites | A | Email, role, reports\_to; sends NTF-02 | 2.5 |
| API-USR-03 | GET /invites/{token} | Pub | Returns company name and role for the accept screen | 2.5 |
| API-USR-04 | POST /invites/{token}/accept | Pub | Sets name and password; returns tokens | 2.5 |
| API-USR-05 | PATCH /users/{id} | A | Role, reports\_to, grants, name; 409 if reports\_to creates a loop | 2.5 |
| API-USR-06 | POST /users/{id}/deactivate | A | Blocks login; keeps history; reassigns nothing automatically | 2.5 |

### Settings and calendar (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-SET-01 | GET /settings | Any | Company settings (F-SET-01) | 3.1 |
| API-SET-02 | PUT /settings | A | Validates weekly off, Saturday rule, min hours 1–12, SLA 1–10 days | 3.1 |
| API-SET-03 | GET /holidays?year= | Any | Sorted by date | 3.2 |
| API-SET-04 | POST /holidays | A | 409 on duplicate date | 3.2 |
| API-SET-05 | DELETE /holidays/{id} | A |  | 3.2 |
| API-SET-06 | POST /holidays/import | A | CSV date,name; returns created and skipped rows | 3.2 |
| API-SET-07 | GET /calendar/working-days?user\_id=&from=&to= | Any (own), A, P | Per-day flag and reason (off, holiday, leave) from SVC-01 | 3.3 |
| API-SET-08 | GET /lookups?kind= | Any | Products, sources, categories | 3.5 |
| API-SET-09 | POST /lookups | A |  | 3.5 |
| API-SET-10 | PATCH /lookups/{id} | A | Rename, reorder, deactivate | 3.5 |

### Projects, milestones, WBS (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-PRJ-01 | GET /projects?status=&q=&type= | Any | E sees projects where they own a task; response includes count per status for the chips | 4.2 |
| API-PRJ-02 | POST /projects | A, P | Code from SVC-05; status defaults to initiated | 4.2 |
| API-PRJ-03 | GET /projects/{id} | Any with access | Header, milestones summary, effort ratio | 4.2 |
| API-PRJ-04 | PATCH /projects/{id} | A, P own | Not status (see PRJ-05) | 4.2 |
| API-PRJ-05 | POST /projects/{id}/status | A, P own | BR-17: reason required for on\_hold, npa, closed; writes DB-10 | 4.3 |
| API-PRJ-06 | GET /projects/{id}/status-history | Any with access | Newest first | 4.3 |
| API-MS-01 | GET /projects/{id}/milestones | Any with access | Ordered by no; excludes deleted | 4.5 |
| API-MS-02 | POST /projects/{id}/milestones | A, P own | Number from SVC-05 (BR-19) | 4.5 |
| API-MS-03 | PATCH /milestones/{id} | A, P own | Name, dates, billing amount | 4.5 |
| API-MS-04 | DELETE /milestones/{id} | A, P own | 409 MS\_INVOICED if invoiced (BR-21); else soft delete, tasks moved to no milestone | 4.5 |
| API-WBS-01 | GET /wbs/template | A, P | CSV template download | 4.7 |
| API-WBS-02 | POST /projects/{id}/wbs-import/preview | A, P own | Multipart CSV/XLSX or pasted text; returns rows with status, errors and a preview token (15 min) | 4.7 |
| API-WBS-03 | POST /projects/{id}/wbs-import/commit | A, P own | Preview token; creates milestones, tasks, dependencies in one transaction; 409 if data changed since preview | 4.7 |

### Tasks and collaboration (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-TSK-01 | GET /tasks?project\_id=&milestone\_id=&owner\_id=&status=&due\_before= | Any with access | Paginated | 5.1 |
| API-TSK-02 | GET /me/tasks | Any | Own open tasks + tasks covered as backup while the owner is on leave | 5.1 |
| API-TSK-03 | POST /tasks | A, P own | Milestone required unless unassigned; number from SVC-05 | 5.1 |
| API-TSK-04 | GET /tasks/{id} | Any with access | Includes dependencies, actual hours, blocked flag | 5.1 |
| API-TSK-05 | PATCH /tasks/{id} | A, P own; owner (status only) | 409 TASK\_BLOCKED when moving to in\_progress with an open dependency (F-TSK-03) | 5.2 |
| API-TSK-06 | DELETE /tasks/{id} | A, P own | 409 if hours are logged against it | 5.1 |
| API-TSK-07 | PUT /tasks/{id}/dependencies | A, P own | Replaces the set; 409 DEP\_CYCLE from SVC-06 | 5.2 |
| API-COL-01 | GET /tasks/{id}/comments | Any with access | Oldest first | 5.4 |
| API-COL-02 | POST /tasks/{id}/comments | Any with access | Parses @mentions; creates NTF-03 per mention | 5.4 |
| API-COL-03 | GET /notifications?unread= | Any | Own only | 5.4 |
| API-COL-04 | POST /notifications/read | Any | Ids or all | 5.4 |
| API-COL-05 | GET /activity?entity=&entity\_id= | A, P | From DB-17, newest first | 5.6 |

### Timesheets, approvals, leave (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-TS-01 | GET /timesheet-weeks/{user\_id}/{week\_start} | Own, approver, A | Creates the open week lazily; returns entries, day totals, working-day flags, min-hours warnings, allowed actions | 6.2 |
| API-TS-02 | PUT /timesheet-weeks/{id}/entries | Own | Replaces the entry set; 409 TS\_NOT\_EDITABLE unless open, rejected or unlocked; leave rows sync to DB-20 (BR-09) | 6.2 |
| API-TS-03 | POST /timesheet-weeks/{id}/submit | Own | Approver from SVC-08; top person auto-approved (BR-07); sends NTF-04 | 6.4 |
| API-TS-04 | POST /timesheet-weeks/{id}/approve | Approver, delegate, A | Stamps late from SVC-09 (BR-10); sends NTF-05 | 6.5 |
| API-TS-05 | POST /timesheet-weeks/{id}/reject | Approver, delegate, A | Reason required (BR-08); reopens the week; NTF-06 | 6.5 |
| API-TS-06 | POST /timesheet-weeks/approve-bulk | Approver, A | Only weeks with no warnings; returns approved and skipped | 6.5 |
| API-TS-07 | GET /approvals | Approver, A | Pending weeks for me and my delegations, days waiting, overdue flag | 6.5 |
| API-TS-08 | POST /timesheet-weeks/{id}/unlock-request | Own | Only when locked; reason required; NTF-07 | 6.6 |
| API-TS-09 | POST /timesheet-weeks/{id}/unlock | Approver, A | Days 1–7; sets unlock\_until; NTF-08 | 6.6 |
| API-LV-01 | GET /leave?user\_id=&from=&to= | Own, approver, A, O |  | 6.2 |
| API-LV-02 | POST /leave | A, O | HR entry; source = hr | 6.2 |
| API-LV-03 | DELETE /leave/{id} | A, O | 409 if the week is approved | 6.2 |

### Costing, margins, invoices, payroll, revenue (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-CST-01 | GET /users/{id}/cost-rates | A, grant salaries | History, newest first | 7.1 |
| API-CST-02 | POST /users/{id}/cost-rates | A | New row with effective\_from; never edits old rows | 7.1 |
| API-CST-03 | GET /projects/{id}/allocations | A, P own | Milestone shown as M-code | 7.2 |
| API-CST-04 | POST /projects/{id}/allocations | A, P own | BR-22 all fields required; returns over-allocation warnings from SVC-12 | 7.2 |
| API-CST-05 | PATCH /allocations/{id} | A, P own | Same checks as CST-04 | 7.2 |
| API-CST-06 | DELETE /allocations/{id} | A, P own |  | 7.2 |
| API-CST-07 | GET /projects/{id}/margins | A, grant margins | Planned and actual per project and milestone from SVC-11; margin and markup | 7.3 |
| API-INV-01 | POST /files | A, P, O | Returns a presigned upload URL; file row created | 7.4 |
| API-INV-02 | GET /files/{id} | Access to parent entity | Presigned download redirect, 5 min | 7.4 |
| API-INV-03 | POST /milestones/{id}/invoice | A | Number, date, amount, file; sets billing\_status invoiced; ledger income row | 7.4 |
| API-INV-04 | POST /invoices/{id}/payments | A | Amount, date; partial allowed; paid when fully paid | 7.4 |
| API-INV-05 | GET /revenue?period=&date= | A | Billed, collected, cost, net for month, quarter, FY (April–March) | 7.6 |
| API-PAY-01 | POST /payroll-runs | A | Month; computes draft via SVC-13; 409 if a final run exists | 7.8 |
| API-PAY-02 | GET /payroll-runs/{id} | A | Lines + warnings (unsubmitted, unapproved weeks) | 7.8 |
| API-PAY-03 | POST /payroll-runs/{id}/recompute | A | Only while draft | 7.8 |
| API-PAY-04 | GET /payroll-runs/{id}/export.csv | A | Bank/accountant format | 7.8 |

### Billing, super admin, export (Release 1)

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-BIL-01 | GET /billing | A | Plan, status, seats used, renewal date | 8.1 |
| API-BIL-02 | POST /billing/checkout | A | Creates Razorpay subscription; returns checkout details | 8.1 |
| API-BIL-03 | POST /webhooks/razorpay | Pub (signed) | Verifies signature; idempotent by event id; updates DB-03 and tenant status | 8.1 |
| API-ADM-01 | GET /admin/tenants | SA | Plan, users, last active, payment status | 8.5 |
| API-ADM-02 | POST /admin/tenants/{id}/extend-trial | SA | Days 1–30; audited | 8.5 |
| API-ADM-03 | POST /admin/tenants/{id}/suspend | SA | Audited | 8.5 |
| API-EXP-01 | POST /exports | A | Starts JOB-08; returns job id | 8.9 |
| API-EXP-02 | GET /exports/{id} | A | Status and download link when ready | 8.9 |

### Release 1.1 endpoints

| ID | Endpoint | Roles | Behaviour and rules | WBS |
| --- | --- | --- | --- | --- |
| API-SAL-01 | GET /deals?stage=&owner\_id= | A, S (own; all if manager) | Board and list | 10.1 |
| API-SAL-02 | POST /deals | A, S | Manual lead form (F-SAL-01); created\_by stamped | 10.1 |
| API-SAL-03 | GET /deals/{id} | A, S own | With stage history and activities as one timeline | 10.1 |
| API-SAL-04 | PATCH /deals/{id} | A, S own | Not stage | 10.1 |
| API-SAL-05 | POST /deals/{id}/stage | A, S own | Writes DB-29; lost needs reason; won stamps won\_on | 10.1 |
| API-SAL-06 | POST /deals/{id}/activities | A, S own | Date, type, note | 10.1 |
| API-SAL-07 | POST /deals/{id}/create-project | A | Only when won; links project\_id | 10.3 |
| API-SAL-08 | GET /sales/compensation?user\_id=&month= | A, S own | SVC-15 result | 10.4 |
| API-SAL-09 | GET /sales/performance?period=&key= | A, S own | F-SAL-05 metrics per person | 10.5 |
| API-SAL-10 | GET /sales/cost-vs-closed?period=&key= | A | F-SAL-04 by month, quarter, year | 10.5 |
| API-PAY-05 | POST /payroll-runs/{id}/finalise | A | Freezes lines; includes variable pay | 10.8 |
| API-LED-01 | GET /ledger?from=&to=&kind= | A | Recurring rows expanded by SVC-16 | 11.1 |
| API-LED-02 | POST /ledger | A |  | 11.1 |
| API-LED-03 | PATCH /ledger/{id} | A |  | 11.1 |
| API-LED-04 | DELETE /ledger/{id} | A | 409 if created by an invoice | 11.1 |
| API-CEO-01 | GET /dashboard/ceo?period=&date= | A | Cards, 12-month series, streams, revenue ahead, project health | 11.2 |
| API-INS-01 | GET /insights/tasks-at-risk | A, P | Due in 3 days, not started | 11.3 |
| API-INS-02 | GET /insights/blocked-tasks | A, P | Open dependency | 11.3 |
| API-INS-03 | GET /insights/overdue-milestones | A, P | Planned end passed, not complete | 11.3 |
| API-INS-04 | GET /insights/effort-outliers | A, P | Effort ratio above 1.2 | 11.3 |
| API-INS-05 | GET /insights/allocation | A, P | People under 80% or over 110% | 11.3 |
| API-INS-06 | GET /insights/timesheet-compliance | A, P | By team, last 8 weeks | 11.3 |
| API-INS-07 | GET /insights/stale-deals | A, S | No activity in 14 days | 11.3 |
| API-CST-08 | GET /projects/{id}/margins?include=projected | A, grant margins | Adds projected margin and milestone level (SVC-11) | 11.5 |
| API-OPS-01 | GET /projects/{id}/change-requests | A, P |  | 11.6 |
| API-OPS-02 | POST /projects/{id}/change-requests | A, P |  | 11.6 |
| API-OPS-03 | POST /change-requests/{id}/decision | A | Approve adds value to contract; option to create milestone | 11.6 |
| API-OPS-04 | GET /openings | A, P, O |  | 11.6 |
| API-OPS-05 | POST /openings | A, P, O |  | 11.6 |
| API-OPS-06 | PATCH /openings/{id} | A, P, O | Status to filled stamps date | 11.6 |
| API-OPS-07 | GET /ops-items?status=&due\_before= | A, O |  | 11.6 |
| API-OPS-08 | POST /ops-items | A, O |  | 11.6 |
| API-OPS-09 | PATCH /ops-items/{id} | A, O |  | 11.6 |
| API-OPS-10 | POST /ops-items/{id}/done | A, O | Recurring items roll to next due date | 11.6 |
| API-KPI-01 | GET /kpi/approvals?period= | A, P (own) | BR-11 score per manager from SVC-10 | 11.8 |
| API-KPI-02 | GET /team/timesheet-grid?weeks=8 | A, P | Status per member per week | 11.8 |
| API-DLG-01 | GET /delegations | A, P own |  | 11.8 |
| API-DLG-02 | POST /delegations | A, P own | Date range; no overlap per person | 11.8 |
| API-DLG-03 | DELETE /delegations/{id} | A, P own |  | 11.8 |
| API-PAR-01 | GET /projects/{id}/gantt | Any with access | Milestones, tasks, dependencies, critical dates | 12.3 |
| API-PAR-02 | GET /daily-updates?user\_id=&from=&to= | Own, A, P |  | 12.2 |
| API-PAR-03 | PUT /daily-updates/{date} | Own | Proof link required | 12.2 |
| API-PAR-04 | POST /auth/google | Pub | Google ID token; links to an existing invited user only | 12.4 |
| API-PAR-05 | POST /users/import | A | CSV invite: name, email, role, reports\_to, CTC | 12.5 |
| API-PAR-06 | POST /auth/2fa/setup | A | TOTP secret + QR | 12.5 |
| API-PAR-07 | POST /auth/2fa/verify | A | Required at login once enabled | 12.5 |
| API-PAR-08 | Header X-View-As: role on all GET routes | A | Responses filtered as that role; all writes rejected 403 while set | 12.5 |

## 6. Domain service deliverables (SVC)

20 pure functions in `api/app/domain/`. They take plain data, touch no HTTP and no request state, and carry every business rule. Routes and jobs only call them. Each must have the listed tests before it merges.

| ID | Function | Rules | Must-pass tests | WBS |
| --- | --- | --- | --- | --- |
| SVC-01 | `working_days(settings, holidays, leave, start, end) -> list[DayInfo]` | BR-01, BR-02 | Sunday off; 2nd and 4th Saturday off, 1st and 3rd on; holiday on a Saturday; half-day leave counts 0.5 | 3.3 |
| SVC-02 | `day_warnings(entries, days, min_hours, breaks_count) -> list[Warning]` | BR-03 | 8.5 h on a 9 h day warns; weekly off with hours does not warn | 6.2 |
| SVC-03 | `week_state(week, now, tz) -> WeekState` (status, editable, allowed actions) | BR-04 to BR-06 | Open week turns locked at Monday 00:00 tenant time; unlocked week editable until unlock\_until; submitted week not editable | 6.2 |
| SVC-04 | `project_transition(project, to_status, reason) -> StatusChange` | BR-17 | on\_hold, npa, closed without reason raise; same-status change rejected | 4.3 |
| SVC-05 | `next_number(session, scope) -> int` | BR-19 | Two concurrent calls never return the same number; deleted numbers never reused | 4.1 |
| SVC-06 | `find_cycle(edges, task_id, new_deps) -> list[id] or None` | F-TSK-03 | A→B→C→A found; self-dependency found; 200-task graph under 50 ms | 5.2 |
| SVC-07 | `can_start(task, deps) -> (bool, blocking_tasks)` | F-TSK-03 | Blocked while any dependency is not done; names the blockers | 5.2 |
| SVC-08 | `approver_of(user, users, delegations, on_date) -> user_id or AUTO` | BR-07 | Reports-to returned; active delegate wins; top person gets AUTO; inactive manager falls back to admin | 6.4 |
| SVC-09 | `approval_due(submitted_at, sla_days, calendar) -> date` and `is_late(due, decided_at)` | BR-10 | Submitted Friday before a 2nd Saturday with SLA 2 is due Tuesday; holidays skipped | 6.5 |
| SVC-10 | `approval_kpi(manager, weeks, period) -> {on_time, late, overdue, score}` | BR-11 | Score = −(late + overdue pending); delegated approvals count to the delegate | 11.8 |
| SVC-11 | `cost_per_hour(ctc, working_days, min_hours)` and `margins(project, entries, rates, allocations, invoices, as_of) -> Margins` | BR-23 to BR-26 | ₹60,000, 22 days, 9 h = ₹303.03/h; 100 approved h on ₹50,000 = 39.4% margin, 65.0% markup; rate change mid-month uses the rate valid each day | 7.3 |
| SVC-12 | `allocation_load(user, allocations, start, end) -> list[DayLoad]` | F-FIN-02 | Two 60% allocations overlapping warn on the overlap days only | 7.2 |
| SVC-13 | `payroll_line(user, month, weeks, leave, rate, calendar) -> PayrollLine` | BR-12, BR-13 | One unapproved week deducts its working days at base ÷ working days in month; LWP adds; approved month deducts nothing | 7.8 |
| SVC-14 | `revenue(period, invoices, payments, ledger, payroll) -> RevenueSummary` | BR-27 | Billed on invoice date, collected on payment date; FY runs April to March | 7.6 |
| SVC-15 | `compensation(user, month, rate, won_deals) -> Compensation` | BR-14 to BR-16 | ₹50,000 CTC at 20%: 95% of target pays ₹40,000; 100% pays ₹50,000 | 10.4 |
| SVC-16 | `expand_recurring(entries, start, end) -> list[Entry]` | F-LED-01 | Monthly entry from April shows once per month; stops after until\_on | 11.1 |
| SVC-17 | `parse_wbs(file) -> PreviewResult` | F-PRJ-06 | Unknown owner, bad date, unknown dependency and circular dependency each produce a row error; 500 rows under 2 s | 4.7 |
| SVC-18 | `milestones_to_sweep(milestones, task_counts, now, days) -> list[id]` | BR-20 | Empty 7 days and not invoiced is swept; invoiced never; adding a task clears empty\_since | 12.1 |
| SVC-19 | `sales_metrics(user, period, deals, activities, comp) -> SalesMetrics` | F-SAL-04, F-SAL-05 | Win rate = won ÷ (won + lost); days lead-to-won averaged over won deals only | 10.5 |
| SVC-20 | `period_bounds(date, key) -> (start, end, label)` | FY rule | 28 Sep 2026 quarter = Jul–Sep, labelled Q2 FY26-27 | 7.6 |

## 7. Background job deliverables (JOB)

12 Celery tasks. Every job must be safe to run twice: it checks state before it changes anything, so a retry or a duplicate beat tick does no harm. Scheduled jobs run hourly and act on tenants whose local time matches, because tenants may sit in different time zones.

| ID | Job | Trigger | Action | Idempotency guard | WBS |
| --- | --- | --- | --- | --- | --- |
| JOB-01 | lock\_ended\_weeks | Hourly; acts when tenant local time passes Monday 00:00 | Last week's open weeks become locked (BR-06) | Only rows with status open and week\_start + 7 days ≤ today | 6.6 |
| JOB-02 | expire\_unlocks | Hourly | Weeks past unlock\_until and not submitted go back to locked | status open and unlock\_until < now | 6.6 |
| JOB-03 | friday\_nudge | Hourly; acts at Friday 16:00 tenant time | NTF-09 to everyone whose current week is not submitted | One per user per week (dedupe key) | 6.7 |
| JOB-04 | approval\_sla\_digest | Hourly; acts at 09:30 tenant time on working days | NTF-10 to each approver with weeks past SLA | One per approver per day | 6.7 |
| JOB-05 | send\_email | Queued by any NTF with email | Renders template, sends via Mailpit (local) or SES (AWS); 3 retries with backoff | Skips if emailed\_at is set | 5.4 |
| JOB-06 | compute\_payroll | Queued by API-PAY-01 and PAY-03 | Runs SVC-13 for every active user; writes DB-27 | Replaces lines only while run is draft | 7.8 |
| JOB-07 | expire\_trials | Daily 01:00 IST | Tenants past trial\_ends\_on with no active subscription become read\_only; NTF-11 three days before | Status check before update | 8.1 |
| JOB-08 | tenant\_export | Queued by API-EXP-01 | Writes one CSV per table to a zip in storage; link valid 24 h | One running export per tenant | 8.9 |
| JOB-09 | purge\_tokens | Daily 03:00 IST | Deletes expired refresh tokens, invites, preview tokens | Delete by expiry only | 2.3 |
| JOB-10 | flag\_stale\_deals | Daily, 08:00 tenant time | Marks deals with no activity in 14 days; NTF-12 to owner | One notice per deal per week | 10.3 |
| JOB-11 | ops\_due\_reminders | Daily, 09:00 tenant time | NTF-13 for ops items due in 3 days or overdue | One per item per day | 11.6 |
| JOB-12 | sweep\_empty\_milestones | Daily 02:00 tenant time | Stamps empty\_since; deletes per SVC-18; activity-log row per delete | SVC-18 is pure; delete checks again inside the transaction | 12.1 |

## 8. Screen deliverables (UI)

41 screens. Each screen ships with loading, empty and error states, works at 375 px wide, and hides actions the API would refuse (the API still enforces them). The prototype board is the visual reference for layout and wording.

| ID | Route | Shows and does | APIs used | Roles | WBS |
| --- | --- | --- | --- | --- | --- |
| UI-01 | /signup | Company, name, email, password; lands on onboarding | AUTH-01 | Pub | 2.6 |
| UI-02 | /login | Email + password; lockout message | AUTH-02 | Pub | 2.6 |
| UI-03 | /reset-password | Request form and set-new-password form | AUTH-05, AUTH-06 | Pub | 2.6 |
| UI-04 | /invite/:token | Shows company and role; set name and password | USR-03, USR-04 | Pub | 2.6 |
| UI-05 | /people | Table of people; invite dialog; edit role, reports-to, grants; deactivate | USR-01, 02, 05, 06 | A | 2.10 |
| UI-06 | /settings/company | All company settings with inline help | SET-01, SET-02 | A | 3.4 |
| UI-07 | /settings/holidays | Year view, add, delete, CSV import | SET-03 to SET-06 | A | 3.4 |
| UI-08 | /projects | List, status chips with counts, search, inline status change, + Create project | PRJ-01, PRJ-05 | Any | 4.4 |
| UI-09 | /projects (dialogs) | Create/edit project form; status reason dialog | PRJ-02, PRJ-04, PRJ-05 | A, P | 4.6 |
| UI-10 | /projects/:id | Header, milestones M1… with tasks 1.1…, milestone edit/delete, inline + Task row, status history | PRJ-03, 06, MS-01 to 04, TSK-03 | Any with access | 4.8 |
| UI-11 | /projects/:id/import | Upload or paste; preview table with row errors; confirm | WBS-01 to 03 | A, P | 4.9 |
| UI-12 | /my-tasks | Open tasks by due date; overdue red; blocked on top; covering list | TSK-02 | Any | 5.3 |
| UI-13 | Task drawer (/tasks/:id) | All fields, status, dependencies with blocking callout, comments | TSK-04, 05, 07, COL-01, 02 | Any with access | 5.5 |
| UI-14 | Notification bell (header) | Unread count, list, mark read, jump to item | COL-03, COL-04 | Any | 5.7 |
| UI-15 | /timesheet/:week | Week grid, one empty picker row, day totals, save, submit, locked and rejected states, unlock request | TS-01, 02, 03, 08 | Any | 6.3, 6.8 |
| UI-16 | /approvals | Pending weeks, overdue badge, approve, reject with reason, bulk approve, unlock | TS-04 to TS-07, TS-09 | Approvers, A | 6.9 |
| UI-17 | /settings/cost-rates | Per person: CTC, variable %, target, history | CST-01, CST-02 | A | 7.5 |
| UI-18 | /projects/:id/allocation | Rows of person, milestone (M-code), %, from, to; over-allocation warnings | CST-03 to CST-06 | A, P | 7.5 |
| UI-19 | /projects/:id (margin panel) | Planned vs actual; margin and markup side by side with one-line help | CST-07 | A, grant | 7.7 |
| UI-20 | Milestone invoice dialog | Invoice number, date, amount, file; record payment | INV-01, 03, 04 | A | 7.9 |
| UI-21 | /home (CEO, Release 1) | Revenue cards for month, quarter, FY with change | INV-05 | A | 7.10 |
| UI-22 | /payroll, /payroll/:id | Pick month, run, warnings, lines, recompute, export CSV | PAY-01 to PAY-04 | A | 7.11 |
| UI-23 | /billing | Plan, seats, renewal, pay by Razorpay | BIL-01, BIL-02 | A | 8.5 |
| UI-24 | /admin | Super-admin tenant list, extend trial, suspend | ADM-01 to 03 | SA | 8.5 |
| UI-25 | Onboarding checklist | First-login steps: settings, holidays, invite, first project, first week; sample-data option | Several | A | 8.7 |
| UI-26 | /settings/data, /privacy, /terms | Data export request and download; static legal pages | EXP-01, EXP-02 | A, Pub | 8.9 |
| UI-27 | /sales | Pipeline board (drag between stages) and list | SAL-01, SAL-05 | A, S | 10.6 |
| UI-28 | /sales/new, /sales/:id | Lead form; deal page with one timeline of stages and activities | SAL-02 to 04, 06, 07 | A, S | 10.2 |
| UI-29 | /sales/performance | Period switch; per-person metrics; cost vs closed | SAL-09, SAL-10 | A, S own | 10.7 |
| UI-30 | /sales/compensation | Base, variable at stake, target, achieved, payout | SAL-08 | A, S own | 10.7 |
| UI-31 | /finance/ledger | Entries, recurring toggle, filters | LED-01 to 04 | A | 11.4 |
| UI-32 | /home (CEO, full) | Cards, 12-month chart, streams, revenue ahead, project health | CEO-01 | A | 11.4 |
| UI-33 | /operations | Ops register with due and overdue | OPS-07 to 10 | A, O | 11.7 |
| UI-34 | /projects/:id/change-requests | CR list, raise, decide | OPS-01 to 03 | A, P | 11.7 |
| UI-35 | /openings | Openings list and edit | OPS-04 to 06 | A, P, O | 11.7 |
| UI-36 | /insights | Eight ready views as tabs | INS-01 to 07, KPI-01 | A, P, S | 11.9 |
| UI-37 | /team | 8-week status grid; manager approval KPI | KPI-01, KPI-02 | A, P | 11.9 |
| UI-38 | /settings/delegations | Delegate approvals for a date range | DLG-01 to 03 | A, P | 11.9 |
| UI-39 | /projects/:id/gantt | Bars, dependency arrows, today line, critical dates | PAR-01 | Any with access | 12.3 |
| UI-40 | Daily update, activity log, covering | EOD form with proof link; activity panel on project page | PAR-02, PAR-03, COL-05 | Any, A, P | 12.6 |
| UI-41 | View as, bulk invite, 2FA | Role switcher (read-only mode banner), CSV invite, TOTP setup | PAR-05 to 08, PAR-04 | A | 12.6 |

## 9. Shared component deliverables (CMP)

22 components in `web/src/components/`. Build a component once, in the milestone that first needs it; later screens reuse it and never copy it. Each has an example page and a test.

| ID | Component | Key props | Behaviour | WBS |
| --- | --- | --- | --- | --- |
| CMP-01 | AppShell | user, tabs | Navy header, tab bar filtered by role, notification bell slot, company name | 1.6 |
| CMP-02 | DataTable | columns, rows, sort, page, onRowClick | Sticky header, sort, pagination, empty and loading rows, horizontal scroll on phones | 1.6 |
| CMP-03 | StatCard | label, value, change, tone | Big number, label, up/down change with colour and arrow (never colour alone) | 1.6 |
| CMP-04 | Form fields | name, label, error, help | Text, number, date, select, textarea; inline error from API `field` | 1.6 |
| CMP-05 | StatusBadge | kind, value | One colour map for project, task, week and deal statuses | 1.6 |
| CMP-06 | Toast | message, tone | Bottom toast, 4 s, stacks | 1.6 |
| CMP-07 | Money | paise, compact | ₹ with Indian grouping (₹1,20,000); compact mode (₹1.2L) | 1.6 |
| CMP-08 | States | kind | Skeleton loader, empty state with action, error state with retry | 1.6 |
| CMP-09 | Can / ProtectedRoute | action, resource | Hides or redirects by permission from /me | 2.8 |
| CMP-10 | PeoplePicker | value, filter | Searchable user select with role hint | 2.10 |
| CMP-11 | FilterChips | options, counts, value | One chip per status plus All, count on each | 4.4 |
| CMP-12 | ReasonDialog | title, required | Confirm dialog; blocks submit until a reason is typed | 4.6 |
| CMP-13 | WeekPicker | weekStart | Previous/next week, "this week" jump, shows week status | 6.3 |
| CMP-14 | HoursCell | value, disabled, offDay | 0.5 steps, keyboard arrows, greyed on weekly off and holidays | 6.3 |
| CMP-15 | WorkItemPicker | tasks, allowLeave | Grouped: My tasks by project and milestone (WBS code), Leave, Internal | 6.3 |
| CMP-16 | MentionInput | value, users | @ autocomplete; returns text and user ids | 5.7 |
| CMP-17 | MilestonePicker | projectId, value | Shows M-code and name | 7.5 |
| CMP-18 | FileUpload | entity, accept, maxMb | Presigned upload, progress, 10 MB default limit | 7.9 |
| CMP-19 | PeriodSwitch | value, onChange | Month, quarter, FY; label like Q2 FY26-27 | 7.10 |
| CMP-20 | BarChart | series, labels | 12-month grouped bars, tooltip, accessible table fallback | 11.4 |
| CMP-21 | KanbanBoard | columns, cards, onMove | Drag between columns, keyboard move, confirm on Lost | 10.6 |
| CMP-22 | GanttChart | items, deps, markers | Bars by date, dependency arrows, today line, critical-date diamonds | 12.3 |

## 10. Notification deliverables (NTF)

17 notification types. Each is one row in DB-16 plus, where marked, one email template sent by JOB-05. Users can mute email per type; in-app notices cannot be muted. Transactional emails (reset, invite, trial) ignore mutes.

| ID | Event | Recipient | In-app | Email | Template fields | WBS |
| --- | --- | --- | --- | --- | --- | --- |
| NTF-01 | Password reset requested | The user | No | Yes | name, reset link, expiry | 2.4 |
| NTF-02 | Invited | Invitee | No | Yes | company, inviter, role, accept link | 2.5 |
| NTF-03 | Mentioned in a comment | Mentioned user | Yes | Yes | who, task code and title, comment excerpt, link | 5.4 |
| NTF-04 | Timesheet submitted | Approver | Yes | Yes | person, week, total hours, warnings count, link | 6.4 |
| NTF-05 | Timesheet approved | Person | Yes | No | week, approver | 6.5 |
| NTF-06 | Timesheet rejected | Person | Yes | Yes | week, approver, reason, link | 6.5 |
| NTF-07 | Unlock requested | Approver | Yes | Yes | person, week, reason, link | 6.6 |
| NTF-08 | Week unlocked | Person | Yes | Yes | week, until date, link | 6.6 |
| NTF-09 | Friday nudge | Anyone not submitted | Yes | Yes | week, hours so far, link | 6.7 |
| NTF-10 | Approvals overdue digest | Approver | Yes | Yes | count, oldest days waiting, list, link | 6.7 |
| NTF-11 | Trial ending in 3 days | Tenant admin | Yes | Yes | end date, billing link | 8.1 |
| NTF-12 | Deal stale | Deal owner | Yes | No | deal, days since activity | 10.3 |
| NTF-13 | Ops item due or overdue | Owner | Yes | Yes | item, due date | 11.6 |
| NTF-14 | Task assigned to you | New owner | Yes | Yes | task code, title, due, assigned by | 5.1 |
| NTF-15 | Milestone auto-deleted | Project PM | Yes | No | project, milestone code and name | 12.1 |
| NTF-16 | Payment failed | Tenant admin | Yes | Yes | amount, retry date, billing link | 8.1 |
| NTF-17 | Data export ready | Requester | Yes | Yes | download link, expiry | 8.9 |

## 11. Permission matrix

This table is the source for `app/permissions/roles.py` and for the permission test suite (TST-03): one test per cell. "Own" = rows the user owns, is assigned to, or manages through reports-to. Grants (margins, salaries) add access on top of the role.

| Resource and action | Admin (CEO) | Project manager | Sales | Operations | Employee |
| --- | --- | --- | --- | --- | --- |
| Company settings, holidays: edit | Yes | No | No | No | No |
| Users: invite, change role, deactivate | Yes | No | No | No | No |
| Projects: create | Yes | Yes | No | No | No |
| Projects, milestones, WBS import: edit, change status | Yes | Own | No | No | No |
| Projects: view | All | All | Linked to own deals | All | With own tasks |
| Tasks: create, edit, delete | Yes | Own projects | No | No | No |
| Tasks: change status | Yes | Own projects | No | No | Own tasks |
| Comments: read, write | Yes | Own projects | No | No | Tasks they can see |
| Timesheet: log and submit | Own | Own | Own | Own | Own |
| Timesheet: approve, reject, unlock | All | Reports | Reports | Reports | Reports (if a manager) |
| Leave: HR entry | Yes | No | No | Yes | No |
| Cost rates, salaries | Yes | Grant | No | Grant | No |
| Allocation | Yes | Own projects | No | No | No |
| Margins | Yes | Grant | No | No | No |
| Invoices, payments, ledger, revenue | Yes | No | No | View ledger | No |
| Payroll | Yes | No | No | No | No |
| Deals: create, edit, move | Yes | No | Own | No | No |
| Sales performance and pay | All | No | Own | No | No |
| Ops register, openings | Yes | Openings | No | Yes | No |
| Insights | All | Own projects and team | Sales views | Ops views | No |
| Billing, data export | Yes | No | No | No | No |

Super admin (Seereon staff) sits outside tenants: tenant list, plan, trial and suspend only; no access to tenant business data.

## 12. Test and DevOps deliverables (TST, OPS)

### Test suites

| ID | Suite | Tool | Covers | Gate | WBS |
| --- | --- | --- | --- | --- | --- |
| TST-01 | Domain rules | pytest | Every SVC item's must-pass tests; one file per BR group | Every PR | Per SVC item |
| TST-02 | Cross-tenant | pytest | Auto-discovers every route; tenant A token on tenant B data must return 404 | Every PR | 1.10 |
| TST-03 | Permission matrix | pytest | One test per cell of section 11 | Every PR | 2.9 |
| TST-04 | Migrations | pytest + Alembic | Upgrade from empty to head and one step down, on every PR | Every PR | 1.12 |
| TST-05 | Frontend units | Vitest + Testing Library | CMP items and screen logic | Every PR | 1.12 |
| TST-06 | API contract | Schemathesis | Fuzzes every endpoint against its OpenAPI schema; no 500s | Nightly | 8.3 |
| TST-07 | E2E core loop | Playwright | Signup, invite, project, WBS import, log week, submit, approve, payroll, margin | Before each release | 8.6 |
| TST-08 | E2E week lifecycle | Playwright | Lock, unlock request, unlock, resubmit, late approval recorded | Before each release | 8.6 |
| TST-09 | Accessibility | axe-core in Playwright | UI-01 to UI-22: no serious or critical issues | Before each release | 8.6 |
| TST-10 | Security | OWASP ZAP baseline, pip-audit, npm audit | No high findings open | Before each release | 8.3 |
| TST-11 | Load | Locust | 200 users, 3 years of synthetic data; p95 page API under 500 ms | Before Release 1 | 8.4 |
| TST-12 | Restore drill | Script | Restore RDS snapshot to a new instance and run smoke tests | Before Release 1 | 9.4 |
| TST-13 | Release 1.1 regression | Playwright | TST-07, TST-08 plus sales, ledger, CEO dashboard flows | Before Release 1.1 | 12.7 |

### DevOps items

| ID | Item | Done when | WBS |
| --- | --- | --- | --- |
| OPS-01 | Monorepo, ruff, eslint, prettier, pre-commit, PR template naming the item ID | Hooks run on commit | 1.1 |
| OPS-02 | docker-compose: postgres, redis, mailpit, minio, api, worker, beat, web | `docker compose up` gives a working app on a new laptop in under 10 min | 1.3 |
| OPS-03 | GitHub Actions CI: lint, TST-01 to TST-05, build | Red build blocks merge | 1.12 |
| OPS-04 | Seed script: demo tenant with the prototype's sample data | One command loads it | 8.7 |
| OPS-05 | Migration script: live prototype board data into the Seereon tenant | Counts match source for people, projects, tasks, weeks, deals | 8.8 |
| OPS-06 | Terraform: VPC, RDS PostgreSQL, ElastiCache, S3, SES, ECR in ap-south-1 | `terraform apply` builds staging from nothing | 9.1 |
| OPS-07 | Production images; ECS services api, worker, beat; ALB; ACM certificate; domain | HTTPS health check green | 9.2 |
| OPS-08 | Frontend on S3 + CloudFront with SPA routing | Deep links load | 9.3 |
| OPS-09 | Secrets Manager; RDS backups 30 days + point-in-time restore | TST-12 passes | 9.4 |
| OPS-10 | Sentry for api and web; CloudWatch alarms for 5xx, CPU, queue depth, job failures | Test alert reaches on-call | 9.5 |
| OPS-11 | CD: merge to main deploys staging; tagged release deploys production; migrations run before new tasks start | One-click rollback proven | 9.6 |
| OPS-12 | SES domain verified (SPF, DKIM, DMARC); Razorpay live keys and webhook | Live test payment of ₹1 refunded | 9.7 |
| OPS-13 | Runbook: deploy, rollback, restore, rotate secrets, on-call contacts | PM signs off at UAT | 9.8 |

## 13. Deliverable summary

303 itemised deliverables: 219 in Release 1 (M1 to M9) and 83 in Release 1.1 (M10 to M12), plus the domain-rule suite that runs in every milestone. The companion spreadsheet lists all 303 with Assignee and Status columns.

| Milestone | DB | API | SVC | JOB | UI | CMP | NTF | TST | OPS | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 Local foundation | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 3 | 3 | 14 |
| M2 Tenants, auth, roles | 6 | 13 | 0 | 1 | 5 | 2 | 2 | 1 | 0 | 30 |
| M3 Calendar and settings | 2 | 10 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 15 |
| M4 Projects and WBS | 4 | 13 | 3 | 0 | 4 | 2 | 0 | 0 | 0 | 26 |
| M5 Tasks and collaboration | 5 | 12 | 2 | 1 | 3 | 1 | 2 | 0 | 0 | 26 |
| M6 Timesheets and approvals | 4 | 12 | 4 | 4 | 2 | 3 | 7 | 0 | 0 | 36 |
| M7 Costing, payroll, revenue | 6 | 16 | 5 | 1 | 6 | 3 | 0 | 0 | 0 | 37 |
| M8 Hardening (local) | 1 | 8 | 0 | 2 | 4 | 0 | 3 | 6 | 2 | 26 |
| M9 AWS and go-live | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 8 | 9 |
| M10 Sales CRM and pay | 3 | 11 | 2 | 1 | 4 | 1 | 1 | 0 | 0 | 23 |
| M11 Finance, CEO, ops, insights | 2 | 28 | 2 | 1 | 8 | 1 | 1 | 0 | 0 | 43 |
| M12 Parity polish | 1 | 8 | 1 | 1 | 3 | 1 | 1 | 1 | 0 | 17 |
| Every milestone (TST-01) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| **Total** | **34** | **131** | **20** | **12** | **41** | **22** | **17** | **13** | **13** | **303** |

M6 and M7 carry the most items and most of the business rules, which is why they sit on the critical path in the build plan. M11 is API-heavy but each endpoint is a thin read over services built earlier.

## 14. Database and table names

One PostgreSQL 16 database per environment, three schemas inside it. Schemas separate what RLS protects (`app`), what only the platform touches (`platform`), and what may never be edited (`audit`).

**Databases**

| Environment | Database | Where |
| --- | --- | --- |
| Local development | `seereon_board_local` | Docker on each laptop |
| Automated tests | `seereon_board_test` | Created and dropped by each CI run |
| Staging | `seereon_board_staging` | AWS RDS, ap-south-1 |
| Production | `seereon_board_prod` | AWS RDS, ap-south-1, Multi-AZ from first paying tenant |

**Database roles**

| Role | Used by | Rights |
| --- | --- | --- |
| `sb_owner` | Alembic migrations only | Owns all schemas; never used by the running app |
| `sb_app` | API and worker | Read/write on `app`, insert-only on `audit`, read on `platform.plans`; no BYPASSRLS |
| `sb_platform` | Super-admin console endpoints | Read/write on `platform`; no access to `app` |
| `sb_readonly` | Support queries, reporting | Read-only, still subject to RLS |

**Tables** (full names; the DB item that creates each one is in brackets)

| Schema | Table | Module | Item |
| --- | --- | --- | --- |
| platform | `platform.tenants` | Tenancy | DB-01 |
| platform | `platform.plans` | Billing | DB-02 |
| platform | `platform.subscriptions` | Billing | DB-03 |
| platform | `platform.admin_audit` | Super admin | DB-34 |
| app | `app.users` | Users | DB-04 |
| app | `app.invites` | Users | DB-05 |
| app | `app.refresh_tokens` | Auth | DB-06 |
| app | `app.holidays` | Calendar | DB-07 |
| app | `app.lookup_values` | Settings | DB-08 |
| app | `app.projects` | Projects | DB-09 |
| app | `app.number_sequences` | Projects | DB-11 |
| app | `app.milestones` | Projects | DB-12 |
| app | `app.tasks` | Tasks | DB-13 |
| app | `app.task_dependencies` | Tasks | DB-14 |
| app | `app.comments` | Collaboration | DB-15 |
| app | `app.notifications` | Collaboration | DB-16 |
| app | `app.timesheet_weeks` | Timesheets | DB-18 |
| app | `app.timesheet_entries` | Timesheets | DB-19 |
| app | `app.leave` | Timesheets | DB-20 |
| app | `app.delegations` | Approvals | DB-21 |
| app | `app.cost_rates` | Costing | DB-22 |
| app | `app.allocations` | Costing | DB-23 |
| app | `app.files` | Files | DB-24 |
| app | `app.invoices` | Finance | DB-25 |
| app | `app.payroll_runs` | Payroll | DB-26 |
| app | `app.payroll_lines` | Payroll | DB-27 |
| app | `app.deals` | Sales | DB-28 |
| app | `app.deal_activities` | Sales | DB-30 |
| app | `app.ledger_entries` | Finance | DB-31 |
| app | `app.change_requests` | Operations | DB-32 |
| app | `app.openings` | Operations | DB-32 |
| app | `app.ops_items` | Operations | DB-32 |
| app | `app.daily_updates` | Delivery | DB-33 |
| audit | `audit.project_status_history` | Projects | DB-10 |
| audit | `audit.activity_log` | All modules | DB-17 |
| audit | `audit.deal_stage_history` | Sales | DB-29 |

36 tables in 34 migration items. `platform.admin_audit` (DB-34, M8, WBS 8.5) is added by this section: it records every super-admin action (who, tenant, action, reason, time), which API-ADM-02 and ADM-03 require. Section 4 lists its columns: actor\_id, tenant\_id, action, reason, at.

## 15. Settings catalogue

Tenant settings live in `platform.tenants.settings` (JSONB), read and written only through one Pydantic model, `TenantSettings`, in `api/app/core/settings_schema.py`. Missing keys take the default below, so adding a setting never needs a data migration. Every change writes an `audit.activity_log` row with old and new values. The setting key is what the validation rules in section 16 refer to.

### Tenant settings (admin edits on UI-06)

| Key | Type | Default | Allowed values | Used by |
| --- | --- | --- | --- | --- |
| `company.name` | text | From signup | 2–120 characters | Header, emails |
| `company.logo_file_id` | file | None | PNG or SVG, max 1 MB | Header, emails |
| `company.time_zone` | IANA zone | Asia/Kolkata | Any IANA zone | All jobs, SVC-03 |
| `company.fy_start_month` | integer | 4 (April) | 1–12 | SVC-20, revenue |
| `company.currency` | code | INR | INR only in v1 (TD-A06) | Money display |
| `calendar.weekly_off` | weekday list | \[Sunday\] | 0–3 days | SVC-01 |
| `calendar.saturday_rule` | choice | some\_off | all\_on, all\_off, some\_off | SVC-01 |
| `calendar.saturday_off_weeks` | integer list | \[2, 4\] | 1–5; required when some\_off | SVC-01 |
| `calendar.min_hours_per_day` | number | 9 | 1–12, step 0.5 | VAL-C01, SVC-11 |
| `calendar.max_hours_per_day` | number | 16 | 8–24 | VAL-C02 |
| `calendar.breaks_count` | yes/no | Yes |  | SVC-02 |
| `timesheet.hours_step` | choice | 0.5 | 0.25, 0.5, 1 | VAL-C03 |
| `timesheet.allow_future_entries` | yes/no | No |  | VAL-C04 |
| `timesheet.internal_note_required` | yes/no | Yes |  | VAL-C05 |
| `timesheet.weekly_lock` | yes/no | Yes |  | VAL-C06, JOB-01 |
| `timesheet.unlock_max_days` | integer | 7 | 1–14 | VAL-C07 |
| `approval.sla_working_days` | integer | 2 | 1–10 | SVC-09, JOB-04 |
| `approval.bulk_approve` | yes/no | Yes |  | VAL-C08 |
| `pay.deduct_unapproved_days` | yes/no | No for new tenants; Yes for Seereon |  | SVC-13 |
| `pay.variable_default_pct` | integer | 20 | 0–50 | Cost-rate form default |
| `pay.target_default` | choice | ctc | ctc (target = monthly CTC), manual | Cost-rate form default |
| `pay.variable_threshold_pct` | integer | 100 | 80–120 | SVC-15 |
| `projects.code_prefix` | text | PRJ | 2–6 capital letters | VAL-C10, SVC-05 |
| `projects.empty_milestone_days` | integer | 7 | 0 (off) to 60 | JOB-12, SVC-18 |
| `projects.margin_floor_pct` | integer | 25 | 0–90 | VAL-C11, insights |
| `projects.effort_ratio_alert` | number | 1.2 | 1.0–3.0 | Insights, project health |
| `allocation.max_pct_per_person` | integer | 100 | 50–150 | VAL-C12 |
| `allocation.block_over` | yes/no | No (warn only) |  | VAL-C12 |
| `daily.proof_required` | yes/no | Yes |  | VAL-C09 |
| `sales.stale_deal_days` | integer | 14 | 3–90 | JOB-10 |
| `notify.friday_nudge_time` | time | 16:00 | 12:00–20:00 | JOB-03 |
| `notify.sla_digest_time` | time | 09:30 | 07:00–12:00 | JOB-04 |
| `security.password_min_length` | integer | 10 | 10–64 | VAL-C13 |
| `security.lockout_attempts` | integer | 5 | 3–10 | VAL-C14 |
| `security.lockout_minutes` | integer | 15 | 5–60 | VAL-C14 |
| `security.session_idle_minutes` | integer | 60 | 15–480 | Auth |
| `security.require_2fa_admins` | yes/no | No | Available from M12 | API-PAR-07 |

### User preferences (each user edits their own)

Stored in `app.users.prefs` (JSONB; add to DB-04).

| Key | Type | Default | Used by |
| --- | --- | --- | --- |
| `notify.email_muted` | list of NTF types | \[\] | JOB-05 (transactional emails ignore mutes) |
| `ui.home_view` | choice | By role | Landing screen |

### Platform settings (Seereon super admin only)

Stored in `platform.plans` and environment config, not per tenant.

| Key | Default | Used by |
| --- | --- | --- |
| `trial_days` | 14 | Signup, JOB-07 |
| `max_upload_mb` | 10 | VAL-F24, CMP-18 |
| `max_wbs_rows` | 1000 | VAL-F25 |
| Plan prices and seat limits | Set per plan | Billing |

`pay.deduct_unapproved_days` defaults to No for new tenants on purpose: withholding pay is a legal question in each customer's jurisdiction, so each company switches it on knowingly.

## 16. Validation rules

42 rules. **Fixed** rules (VAL-F) protect data integrity, money and law; no tenant can switch them off. **Configurable** rules (VAL-C) read a setting from section 15. Every rule is enforced in the API; the database backs up the ones marked DB; the screen repeats them only to give early feedback.

All error codes and messages live in one catalogue, `api/app/core/errors.py`, exported to the frontend at build time so the screen and the API always show the same words. **Block** = request refused. **Warn** = saved, with a warning shown and returned in `warnings[]`.

### Fixed rules (VAL-F)

| ID | Rule | Enforced in | Error code | Type |
| --- | --- | --- | --- | --- |
| VAL-F01 | Email is valid and unique within the tenant, case-insensitive | API, DB | USER\_EMAIL\_TAKEN (409) | Block |
| VAL-F02 | Reports-to cannot be the person themselves or create a loop | API | USER\_REPORTS\_LOOP (409) | Block |
| VAL-F03 | A tenant always keeps at least one active admin | API | LAST\_ADMIN (409) | Block |
| VAL-F04 | A timesheet week starts on a Monday | API, DB | TS\_BAD\_WEEK (422) | Block |
| VAL-F05 | Entry hours are 0–24 and the date falls inside the week | API, DB | TS\_BAD\_HOURS (422) | Block |
| VAL-F06 | Only open, rejected or unlocked weeks can be edited | API | TS\_NOT\_EDITABLE (409) | Block |
| VAL-F07 | Rejecting a week needs a reason of at least 5 characters | API | TS\_REASON\_REQUIRED (422) | Block |
| VAL-F08 | Nobody approves their own week (the top person is auto-approved) | API | TS\_SELF\_APPROVAL (403) | Block |
| VAL-F09 | Task time only on tasks the person owns, backs up, or is allocated to | API | TS\_TASK\_NOT\_ALLOWED (403) | Block |
| VAL-F10 | No new hours on a completed or closed project after its status date | API | TS\_PROJECT\_CLOSED (409) | Block |
| VAL-F11 | On hold, NPA and closed need a reason (BR-17) | API | BR\_17\_REASON\_REQUIRED (422) | Block |
| VAL-F12 | End date on or after start date (projects, milestones, tasks, allocations, delegations) | API, DB | DATE\_RANGE (422) | Block |
| VAL-F13 | Milestone and task numbers never change; an invoiced milestone cannot be deleted | API | MS\_INVOICED (409) | Block |
| VAL-F14 | A task cannot depend on itself or form a cycle | API | DEP\_CYCLE (409) | Block |
| VAL-F15 | A task cannot start while a dependency is open | API | TASK\_BLOCKED (409) | Block |
| VAL-F16 | A task with logged hours cannot be deleted | API | TASK\_HAS\_HOURS (409) | Block |
| VAL-F17 | Allocation has person, milestone of the same project, % from 1 to 100, and dates inside the project | API, DB | ALLOC\_INVALID (422) | Block |
| VAL-F18 | A cost rate cannot start inside a month whose payroll is final | API | RATE\_PERIOD\_LOCKED (409) | Block |
| VAL-F19 | Payments cannot exceed the invoice's outstanding amount | API | INV\_OVERPAY (422) | Block |
| VAL-F20 | Invoice numbers are unique within the tenant | API, DB | INV\_NUMBER\_TAKEN (409) | Block |
| VAL-F21 | One payroll run per month; a final run cannot change | API, DB | PAY\_FINAL (409) | Block |
| VAL-F22 | Money is a whole number of paise, zero or more | API, DB | MONEY\_INVALID (422) | Block |
| VAL-F23 | Lost needs a reason; won needs a value above zero; only an admin moves a deal out of won or lost | API | DEAL\_STAGE (409) | Block |
| VAL-F24 | Uploads are PDF, PNG, JPG, XLSX, CSV or DOCX and within `max_upload_mb` | API | FILE\_REJECTED (422) | Block |
| VAL-F25 | WBS import has the required columns and at most `max_wbs_rows` rows | API | WBS\_INVALID (422) | Block |
| VAL-F26 | A write carries the row's current version | API | STALE (409) | Block |
| VAL-F27 | A read-only tenant (trial ended, unpaid) can only use billing | API | TENANT\_READ\_ONLY (402) | Block |
| VAL-F28 | No leave on a non-working day, and one leave row per person per date | API, DB | LEAVE\_INVALID (422) | Block |

### Configurable rules (VAL-C)

| ID | Rule | Setting | Error code | Type |
| --- | --- | --- | --- | --- |
| VAL-C01 | Hours on a working day below the minimum | `calendar.min_hours_per_day` | TS\_BELOW\_MIN | Warn |
| VAL-C02 | Hours on a day above the maximum | `calendar.max_hours_per_day` | TS\_OVER\_MAX (422) | Block |
| VAL-C03 | Hours are a multiple of the step | `timesheet.hours_step` | TS\_BAD\_STEP (422) | Block |
| VAL-C04 | No hours on future dates unless allowed | `timesheet.allow_future_entries` | TS\_FUTURE (422) | Block |
| VAL-C05 | Internal time needs a note | `timesheet.internal_note_required` | TS\_NOTE\_REQUIRED (422) | Block |
| VAL-C06 | A week locks when it ends unless submitted | `timesheet.weekly_lock` | TS\_LOCKED (409) | Block |
| VAL-C07 | An unlock lasts 1 day up to the maximum | `timesheet.unlock_max_days` | TS\_UNLOCK\_RANGE (422) | Block |
| VAL-C08 | Bulk approve only when switched on, and only weeks with no warnings | `approval.bulk_approve` | TS\_BULK\_OFF (403) | Block |
| VAL-C09 | A daily update needs a proof link | `daily.proof_required` | DU\_PROOF\_REQUIRED (422) | Block |
| VAL-C10 | Project codes use the tenant prefix | `projects.code_prefix` | Generated, never typed | Fixed format |
| VAL-C11 | Projected margin below the floor | `projects.margin_floor_pct` | MARGIN\_BELOW\_FLOOR | Warn |
| VAL-C12 | A person allocated above the maximum on any day | `allocation.max_pct_per_person`, `allocation.block_over` | ALLOC\_OVER | Warn, or Block when block\_over is on |
| VAL-C13 | Password length | `security.password_min_length` | PASSWORD\_WEAK (422) | Block |
| VAL-C14 | Login lockout after repeated failures | `security.lockout_attempts`, `security.lockout_minutes` | LOGIN\_LOCKED (429) | Block |

**How to build it:** each rule is one function in `api/app/domain/validation/` named after its ID (`val_f14_dep_cycle`), called from the routes listed in section 5, with a unit test for pass and fail. The rules are part of the API and SVC items they sit in, so they add no separate deliverables to the count in section 13.
