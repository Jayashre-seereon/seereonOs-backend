# Debt register

29 items in three groups. Prototype debt is paid off inside the build, deferred debt has a milestone, and accepted debt has a trigger that reopens it.

## How to run this register

The PM owns this list and reviews it at every milestone gate. Debt that is written down gets paid; debt that isn't written down just builds up.

| Field | Meaning |
| --- | --- |
| ID | TD-P (prototype), TD-D (deferred), TD-A (accepted) + number |
| Debt | The shortcut, in one line |
| Interest | What it costs every day it stays unpaid |
| Payoff | The Technical design items (DB, API, SVC, JOB, UI, TST, OPS) that remove it |
| Priority | P1 must be paid before Release 1 goes live. P2 before Release 1.1. P3 accepted until its trigger fires |
| Proof | The test or check that shows it is paid |

**Policy**

1. No new shortcut merges without a TD row and the PM's approval in the PR.
2. A P1 row that is still open blocks the go-live gate (9.8 in the build plan).
3. When a P3 trigger fires, the row moves to P2 and gets a milestone.
4. After Release 1.1, about 15% of each sprint goes to the oldest open rows.

## Prototype debt (14 items, all P1)

The prototype proved the rules but was built for speed, not scale or safety. None of its code is ported: each shortcut below is paid off by designing it out of the SaaS build, and the Proof column shows how that is checked.

| ID | Debt | Interest | Payoff | Proof |
| --- | --- | --- | --- | --- |
| TD-P01 | All logic, UI and styles in one 300 KB HTML file | Nothing can be tested or reused on its own; every change risks everything | Repo layout (section 3); UI and CMP items rebuilt in React | Code review at M1 gate |
| TD-P02 | Payroll, margins and working days calculated in the browser | Results can be changed from browser dev tools; rules copied in several places | SVC-01 to SVC-20 on the server; screens only display results | TST-01 |
| TD-P03 | Roles enforced by hiding tabs; anyone with board access can read all data; role depends on account linking | Salaries and margins visible to people who should not see them | Permission layer (2.7), section 11 matrix, grants | TST-03 |
| TD-P04 | No tenant concept: one shared board | Cannot sell to a second company | DB-01, tenant\_id on every table, RLS | TST-02 |
| TD-P05 | Milestones and tasks stored as arrays inside one document per project | Two people editing the same project overwrite each other (last write wins) | DB-12, DB-13 as tables; If-Match version on every write | API test: concurrent edit returns 409 STALE |
| TD-P06 | Scheduled logic runs in an open browser tab (milestone sweep every 5 s; week lock worked out on view) | Runs only if someone has the board open; may run many times at once | JOB-01, JOB-02, JOB-12 on the worker | Job tests; idempotency guard |
| TD-P07 | Dates and week keys from the browser clock as text | Wrong week near midnight or in another time zone; lock and SLA drift | DATE and TIMESTAMPTZ columns; tenant time zone in SVC-03 | SVC-03 midnight tests |
| TD-P08 | Money held as decimal rupees in JavaScript numbers | Rounding drift in margin and payroll totals | Paise as BIGINT; CMP-07 for display | SVC-11 and SVC-13 tests to the rupee |
| TD-P09 | Any client write accepted as sent; no server validation | Bad or malicious data saved | Pydantic schemas on all 131 API items | TST-06 contract fuzzing |
| TD-P10 | History kept as arrays inside the same editable document | History can be rewritten; no reliable audit | Append-only DB-10, DB-17, DB-29 | DB grant test: UPDATE refused |
| TD-P11 | HTML built from strings with a hand-written escape helper | One missed escape is a cross-site scripting hole | React rendering (escaped by default); no raw HTML injection allowed by lint rule | TST-10; lint rule in OPS-01 |
| TD-P12 | Loads every record on open; no pagination | Fine at 10 people, slow at 200 | Pagination convention on every list API | TST-11 load test |
| TD-P13 | Tests are hand-run scripts | Regressions found by users | TST-01 to TST-05 in CI on every PR | OPS-03 red build blocks merge |
| TD-P14 | Salary and rate data protected only by storage rules configuration | One misconfigured rule exposes pay data | Field stripping by grant in the API; separate endpoints API-CST-01, CST-02 | TST-03 salary cells |

## Deferred debt (8 items, P2)

These were moved out of Release 1 on purpose to keep the critical path short. Each one has an interim workaround so Release 1 is safe to run without it.

| ID | Debt | Interest until paid | Interim workaround | Payoff | Milestone |
| --- | --- | --- | --- | --- | --- |
| TD-D01 | No Google sign-in | More friction at signup | Email and password with reset | API-PAR-04 | M12 |
| TD-D02 | No two-factor login for admins | Admin account takeover risk | Login lockout (API-AUTH-02), 10-character minimum password | API-PAR-06, PAR-07 | M12 |
| TD-D03 | Payroll runs cannot be finalised and frozen | A draft can be recomputed after salaries are paid | The exported CSV is the record of payment; admin-only access | API-PAY-05 | M10 |
| TD-D04 | Only planned vs actual margin; no projected or milestone-level margin | Overruns show up late | PM checks effort ratio on the project list weekly | API-CST-08 | M11 |
| TD-D05 | No manager approval KPI and no approval delegation | Late approvals go unmeasured; leave cover is manual | JOB-04 digest; admin approves when a manager is away | API-KPI-01, DLG-01 to 03 | M11 |
| TD-D06 | Empty milestones are not cleaned up automatically | Clutter in milestone lists | PM deletes by hand (API-MS-04) | JOB-12, SVC-18 | M12 |
| TD-D07 | No Gantt view | Harder to see dependencies and critical dates | Milestone list with dates and the blocked-task callout | UI-39, API-PAR-01 | M12 |
| TD-D08 | No bulk CSV invite and no "view as" | Slow onboarding for larger teams; admin cannot check role views | Invite one by one; test with a second account | API-PAR-05, PAR-08, UI-41 | M12 |

## Accepted debt after Release 1.1 (7 items, P3)

These are design choices that are right for now and wrong later. Each has a trigger; when it fires, the row becomes P2 and gets a milestone.

| ID | Choice we keep | Why it is right now | Trigger to revisit | Likely payoff |
| --- | --- | --- | --- | --- |
| TD-A01 | One shared database with row-level security, not a database per tenant | Cheapest to run; RLS plus TST-02 keeps tenants apart | An enterprise buyer requires isolated data, or more than 500 tenants | Schema or database per tenant for a premium plan |
| TD-A02 | Self-run Celery and Redis for jobs | Same code locally and on AWS | More than one queue incident a month, or workers need autoscaling | Amazon SQS with a managed worker service |
| TD-A03 | Notifications fetched every 30 s, not pushed | Simple; no socket servers | Users ask for instant updates, or 2,000+ users online at once | WebSocket or server-sent events channel |
| TD-A04 | Payroll gives the payable amount only; no PF, ESI, TDS, professional tax or payslips | Keeps v1 out of statutory compliance | Three paying tenants ask for it, or legal review says so | Statutory payroll module or a payroll-provider integration |
| TD-A05 | Single AWS region (Mumbai); recovery from backups (data loss up to 5 min, restore in hours) | Meets the 99.5% target at low cost | A contract needs more than 99.5% uptime or a recovery time under 1 hour | Standby database in a second region |
| TD-A06 | English and INR only | All early customers are in India | First customer outside India (for example a Gulf client) | Multi-currency amounts, locale formats, translations |
| TD-A07 | No public API or webhooks for customers | Fewer surfaces to secure and support | Integration requests (Jira, Tally, Zoho) from paying customers | Public API keys, webhooks, rate limits |
