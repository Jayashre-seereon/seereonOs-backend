# Seereon Delivery Board: BRD, FSD and Project Plan

Sep 27, 2026 · @Santosh

This document turns the working v1 prototype into a multi-tenant SaaS product. Developers build from the FSD and data model. The project manager runs delivery from the scope and WBS. No dates are set here on purpose.

## 1. Product overview

Seereon Delivery Board is one system where a services or product company runs delivery, people, sales and money together. It connects each hour logged to a task, a milestone, a project, a cost and an invoice. The CEO sees revenue and margin; the manager sees the team; the employee sees their own work.

**Who buys it.** Indian IT services, SAP/ERP consulting and small product companies with 10 to 200 people. The buyer is the founder or CEO. Daily users are project managers, employees, sales and operations staff.

**Why they buy it.** Today these companies run delivery in Jira or sheets, time in another tool, sales in a CRM and payroll in Excel. Nobody can answer "did we make money on this project, this month?" without a week of reconciliation. This product answers it live.

**How it is sold.** Monthly or yearly subscription per company (tenant), priced per active user. Each company gets its own isolated workspace, its own admin, and a self-serve signup with a free trial.

**Source of truth for behaviour.** The v1 prototype board is the reference. Where this document and the prototype disagree, this document wins; raise the gap with the project manager.

## 2. BRD: business objectives

The product exists to make every rupee and every hour traceable. Each objective below has a measure the customer can see inside the product.

| # | Objective | How we measure it in the product |
| --- | --- | --- |
| O1 | Know project profit live | Planned, projected and actual margin per project, per milestone |
| O2 | Stop unlogged and unapproved time | % of weeks submitted on time; % approved within SLA |
| O3 | Pay only for approved work | Payroll deductions for unapproved days, shown per person per month |
| O4 | Make managers accountable for approvals | Manager approval KPI (negative score for late or missed approvals) |
| O5 | Tie sales cost to sales results | Sales cost vs deals closed by month, quarter and year; variable pay only on target |
| O6 | Give the CEO one revenue view | Monthly, quarterly and yearly billed, collected, cost, net |
| O7 | Cut delivery surprises | Tasks at risk, blocked dependencies, overdue milestones on the Insights tab |

**Business success for Seereon as a SaaS vendor:** paying tenants, monthly recurring revenue, trial-to-paid conversion, and weekly active users per tenant. These are tracked in the super-admin console, not in the customer's board.

## 3. BRD: users and roles

Every user has exactly one role inside a tenant. The role decides which tabs they see and what they can change. A user sees only their own tenant's data.

| Role | Who | Sees | Can do |
| --- | --- | --- | --- |
| Super admin | Seereon staff | All tenants' plan, usage, billing status. Never customer business data. | Create or suspend tenants, change plans, impersonate only with customer consent (logged) |
| Tenant admin (CEO) | Founder or CEO | Everything in the tenant: revenue, finance, margins, payroll, all projects, all people | Company settings, calendar, cost rates, users and roles, unlock any timesheet, run payroll |
| Project manager | Delivery lead | Their projects, their team's timesheets and tasks, planned vs actual effort; margins only if granted | Create projects, milestones, tasks; import WBS; allocate people; approve team timesheets; change project status |
| Sales | Sales executive | Their own leads and deals, own performance and pay progress; team pipeline if manager | Create leads, move stages, log activities, mark won or lost |
| Operations | Admin, HR, accounts | Operations register, leave, openings, ledger entries (not salaries unless granted) | Log operations items, record leave, record income and expense |
| Employee | Everyone else | Own tasks, own timesheet, own leave, threads they are in | Log time, save and submit week, update task status, request unlock, comment |

**Reporting line.** Each person has one "reports to". That manager approves their timesheet. The top person (no manager) is auto-approved.

**Backup and delegation.** A manager can delegate approvals to another person for a date range. A task can have a backup owner who covers it during leave.

## 4. BRD: business rules

These rules are the product. Developers must implement them exactly and cover each with an automated test (test id = rule id). Values shown in brackets are tenant settings with their default.

**Working calendar**

1. BR-01 A working day is any day that is not a weekly off, a tenant holiday or the person's approved leave.
2. BR-02 Weekly off defaults to Sunday. Saturdays can be all on, all off, or off on chosen weeks of the month \[2nd and 4th\].
3. BR-03 Minimum hours per working day \[9\]. A setting decides whether breaks count toward it \[yes\].

**Timesheets**

4. BR-04 A timesheet is one person, one week (Monday to Sunday). Statuses: open, submitted, approved, rejected, locked.
5. BR-05 The person can save a draft any time and submit once. After submit, the week is read-only for them.
6. BR-06 When the week ends and it is not submitted, it becomes locked. Only the approver or tenant admin can unlock it, for a set window. The person can request unlock with a reason.
7. BR-07 The approver is the person's "reports to" manager, or an active delegate. The top person is auto-approved.
8. BR-08 A rejection must carry a reason. Rejected weeks reopen for the person to fix and resubmit.
9. BR-09 Leave entered in the timesheet creates a leave record, and leave records show in the timesheet.

**Manager accountability**

10. BR-10 The approval SLA is \[2\] working days after submission.
11. BR-11 Each approval decided after the SLA, and each submission still pending past the SLA, counts against the manager. It shows as a negative Approvals KPI on the manager's scorecard. It never blocks the manager from using the product.

**Pay**

12. BR-12 Salary is paid only for approved days. Deduction = monthly base ÷ working days in the month × (unapproved working days + leave-without-pay days).
13. BR-13 A day is unapproved if its week is not approved at payroll run time. Payroll shows each deduction line with the week it came from.
14. BR-14 Sales pay = base + variable. Variable is \[20\]% of CTC by default. The monthly sales target defaults to the person's monthly CTC.
15. BR-15 Variable is earned only when achieved ≥ 100% of target for that month. No partial variable.
16. BR-16 Achieved = value of deals marked won in that month where the person is owner.

**Projects and delivery**

17. BR-17 Project statuses: Initiated, Active, On hold, NPA (non-performing), Completed, Closed. Moving to On hold, NPA or Closed needs a reason. Every change is kept in a status history.
18. BR-18 Project types: Product, Service, SaaS, AMS.
19. BR-19 Milestones are numbered M1, M2… per project. Tasks are numbered within their milestone. WBS code = milestone no. + task no. (e.g. 2.3). Numbers are never reused after delete.
20. BR-20 A milestone with no tasks for \[7\] days is deleted automatically, unless it has been invoiced.
21. BR-21 An invoiced milestone cannot be deleted. Deleting a milestone moves its tasks to "No milestone".
22. BR-22 Every resource allocation row must name a milestone, a start date and an end date.

**Money definitions**

23. BR-23 Cost per hour = monthly CTC ÷ (working days in month × minimum hours).
24. BR-24 Margin % = (revenue − cost) ÷ revenue. Markup % = (revenue − cost) ÷ cost. They are not the same: a 50% markup is a 33% margin. The product shows margin by default.
25. BR-25 Planned margin uses estimated hours and allocation. Projected margin uses actual hours to date plus remaining estimate. Actual margin uses approved hours and invoiced revenue only.
26. BR-26 Effort ratio = actual hours ÷ estimated hours. Above 1.0 means the work is taking longer than planned.
27. BR-27 Revenue is recognised as billed when a milestone invoice is raised, and as collected when payment is recorded.

## 5. FSD: platform, tenancy and access

One shared application and one shared database, with every business row stamped with `tenant_id` and isolated by PostgreSQL row-level security. This is the cheapest model to run and still safe if RLS is enforced in the database, not only in code.

**Recommended stack**

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Next.js, TypeScript, a component library (e.g. Mantine or shadcn/ui) | Fast to build tables and forms; the prototype's screens map one to one |
| API | Python FastAPI, REST + OpenAPI | Your team knows Python; typed schemas generate the frontend client |
| Database | PostgreSQL 16 with row-level security | Money needs transactions; RLS gives tenant isolation |
| Jobs | Celery + Redis (or a cron worker) | Weekly lock, SLA checks, milestone sweep, reminders, payroll runs |
| Files | S3 (Mumbai region) | WBS uploads, invoices, attachments |
| Auth | Email + password and Google sign-in; JWT access + refresh tokens | Self-serve signup without a sales call |
| Billing | Razorpay Subscriptions | INR, UPI, GST invoices |
| Email | Amazon SES or Postmark | Invites, reminders, approvals |
| Hosting | AWS ap-south-1 (Mumbai) | Data stays in India for DPDP comfort |

**F-PLT-01 Signup and tenant creation.** A visitor signs up with company name, work email and password. The system creates the tenant, makes the person tenant admin, seeds default settings (BR-02, BR-03, BR-10) and starts a trial.

**F-PLT-02 Invite users.** Tenant admin invites by email, choosing role and "reports to". The invitee sets a password from the link. Bulk invite by CSV (name, email, role, reports to, monthly CTC).

**F-PLT-03 Roles and permissions.** Roles as in section 3. Permissions are checked in the API on every call, never only by hiding UI. Extra grants per person: "can see margins", "can see salaries".

**F-PLT-04 View as.** Tenant admin can view the app as any role to check what others see. Read-only while in this mode.

**F-PLT-05 Tenant isolation.** Every table except global lookups has `tenant_id`. The API sets the tenant on the database session; RLS policies reject any cross-tenant read or write. An automated test tries cross-tenant access on every endpoint and must fail.

**F-PLT-06 Subscription.** Plans by active user count. Trial ends → tenant becomes read-only until payment. Razorpay webhook updates plan status. GST invoice emailed each cycle.

**F-PLT-07 Super-admin console.** Seereon staff list tenants, plan, user count, last active, payment status. They can extend a trial or suspend a tenant.

## 6. FSD: projects, milestones and WBS

The Projects tab opens on a list. Clicking a row drills into that project's milestones and tasks.

**F-PRJ-01 Project list.** Table with code, name, client, type, status, PM, milestones done/total, effort ratio, projected margin (if permitted). Filter chips, one per status (Initiated, Active, On hold, NPA, Completed, Closed) plus All, each with a count. Search by name or client. "+ Create project" button at the top.

**F-PRJ-02 Create or edit project.** Fields: name (required), client, type (BR-18), status (default Initiated), PM, start date, end date, contract value, billing model (fixed / T&M / subscription / AMS retainer), description. Code is auto-generated per tenant (e.g. PRJ-014).

**F-PRJ-03 Change status.** Inline dropdown on the list row and on the project page. Reason prompt per BR-17. Status history panel shows from, to, who, when, reason.

**F-PRJ-04 Milestones.** Add, edit, delete a milestone: name, planned start, planned end, billing amount, billing status (not billed / invoiced / paid). Auto-number per BR-19. Delete rules per BR-21.

**F-PRJ-05 Add task under a milestone.** Each milestone has an inline "+ Task" row: title, owner, estimated hours, due date. Enter saves and opens the next empty row.

**F-PRJ-06 WBS import.** Upload CSV/XLSX or paste from a sheet. Columns: Milestone, Task, Owner, Estimated hours, Start, End, Complexity, Depends on, Milestone billing. Downloadable template. Before saving, show a preview: rows OK, rows with errors (unknown owner, bad date, unknown dependency) and what will be created. Import is all-or-nothing in one transaction. Owners matched by name or email.

**F-PRJ-07 Auto-cleanup of empty milestones.** A nightly job stamps `empty_since` on milestones with no tasks and clears it when a task is added. It deletes those empty for \[7\] days and not invoiced (BR-20). The deletion is written to the activity log.

**F-PRJ-08 Gantt view.** Milestones and tasks as bars by planned dates, dependencies as arrows, today line, critical dates (milestone ends, go-live) marked. Read-only in v1.

**Acceptance:** a PM imports a 40-row WBS with 5 milestones, sees M1–M5 with tasks 1.1–5.n, changes status to On hold with a reason, and the list filter "On hold" shows it.

## 7. FSD: tasks and collaboration

A task is the smallest unit of work and the only thing time can be logged against (besides leave and internal time).

**F-TSK-01 Task fields.** WBS code (auto), title, milestone, owner, backup owner, estimated hours, actual hours (sum of timesheet hours, read-only), start date, due date, complexity (low / medium / high), status (To do, In progress, Blocked, In review, Done), depends on (other task codes), description.

**F-TSK-02 My tasks.** Each person sees their open tasks sorted by due date, with overdue in red and blocked ones on top.

**F-TSK-03 Dependencies.** A task cannot move to In progress while a task it depends on is not Done; the UI shows a callout naming the blocking task and its owner. Circular dependencies are rejected on save and on WBS import.

**F-TSK-04 Backup owner.** When the owner has approved leave on a working day, the backup sees the task in their "Covering" list and can log time against it.

**F-TSK-05 Threads.** Each task has a comment thread. Typing @name mentions a person; they get an in-app notification and an email. A "Mentions" card lists unread mentions for the person.

**F-TSK-06 Activity log.** Every create, edit, status change and delete on projects, milestones and tasks is recorded with who, when, old and new values. Shown on the project page.

**F-TSK-07 Daily update (optional per tenant).** End-of-day note and a demo link per person per day, shown to the manager.

**Acceptance:** task 2.3 depends on 2.1; the owner of 2.3 cannot start it until 2.1 is Done, and sees who owns 2.1.

## 8. FSD: timesheets and approvals

The timesheet is the most used screen and the input to payroll and margins. It must be fast on a phone.

**F-TS-01 Week grid.** Rows = work items, columns = Mon–Sun, cells = hours (0.5 steps). Weekly offs and holidays are greyed. Per-day totals turn amber below the minimum hours (BR-03).

**F-TS-02 One row at a time.** The grid always shows one empty row at the bottom. Its picker lists: "My tasks" (grouped by project and milestone, WBS code shown), Leave (full / half day, paid or LWP), Internal (meetings, training, pre-sales). Picking a task pins it; saved rows show only if they have hours.

**F-TS-03 Save and submit.** "Save" keeps a draft. "Submit" asks for confirmation, sets status submitted and notifies the approver.

**F-TS-04 State transitions.**

| From | Event | To | Who |
| --- | --- | --- | --- |
| Open | Submit | Submitted | Person |
| Open | Week ends (Sunday 23:59 tenant time) | Locked | System job |
| Locked | Request unlock (with reason) | Locked, request flagged | Person |
| Locked | Unlock for N days | Open until unlock expires | Approver or admin |
| Submitted | Approve | Approved | Approver |
| Submitted | Reject (reason required) | Rejected | Approver |
| Rejected | Fix and resubmit | Submitted | Person |
| Submitted (top person) | Submit | Approved (auto) | System |

**F-TS-05 Approvals inbox.** Managers see pending weeks with person, week, total hours, days below minimum, days waiting, and an overdue badge past SLA. Actions: approve, reject with reason, open the week. Bulk approve for weeks with no warnings.

**F-TS-06 Team view.** Manager sees a grid of team members × last 8 weeks, each cell coloured by status.

**F-TS-07 Manager approval KPI (BR-11).** On the manager's scorecard: approvals on time, late, and pending past SLA. Score = −(late + overdue pending). Shown on the People and Insights tabs. It does not block the manager.

**F-TS-08 Reminders.** Friday afternoon reminder to anyone not submitted. Daily reminder to approvers with anything past SLA.

**F-TS-09 Delegation.** A manager delegates approvals to a named person for a date range; the delegate's inbox shows those weeks.

**Acceptance:** a week left unsubmitted locks Monday 00:00; the person requests unlock; the manager unlocks for 2 days; the person submits; the manager approves on day 3 and the KPI records one late approval.

## 9. FSD: allocation, costing and margins

This module turns people's time into project cost. Access is limited to tenant admin and anyone granted "can see margins".

**F-FIN-01 Cost rates.** Per person: monthly CTC, variable % (sales), monthly sales target, effective-from date. Rate changes keep history; cost is always calculated with the rate valid on the day the hours were worked. Cost per hour per BR-23.

**F-FIN-02 Allocation.** Per project: rows of person, milestone (shown as M1, M2… with name), allocation %, from date, to date. All four are mandatory (BR-22). Warn when a person's total allocation across projects exceeds 100% on any day.

**F-FIN-03 Planned cost.** Σ over allocation rows of (cost per hour × minimum hours × working days in range × allocation %). Also from task estimates: Σ (estimated hours × owner's cost per hour). Show both; the PM chooses which drives planned margin.

**F-FIN-04 Margin panel.** For each project and each milestone:

| Measure | Revenue used | Cost used |
| --- | --- | --- |
| Planned | Contract or milestone billing value | Planned cost (F-FIN-03) |
| Projected | Contract or milestone billing value | Actual cost to date + remaining estimate × rate |
| Actual | Invoiced amount | Cost of approved hours only |

Show margin % and markup % side by side with a one-line explanation (BR-24). Flag red when projected margin falls below the tenant's floor \[25%\].

**F-FIN-05 Effort ratio.** Per task, milestone and project (BR-26). Shown on the project list and in Insights.

**Acceptance:** with a ₹60,000 CTC, 22 working days and 9 hours, cost per hour is ₹303.03; 100 approved hours on a ₹50,000 milestone gives ₹30,303 cost and 39.4% actual margin (65.0% markup).

## 10. FSD: sales CRM and compensation

Sales must be traceable from first contact to cash, and every salesperson's cost must be visible against what they closed.

**F-SAL-01 Create lead manually.** Form: title, client, contact name, phone, email, product (tenant's product list + Custom), source (Referral, BNI, Website, Cold call, Event, Partner, Other), owner (default = me), deal value, monthly recurring value, expected close date. Created by and created on are stamped.

**F-SAL-02 Pipeline.** Stages: Lead, Qualified, Demo, Proposal, Negotiation, Won, Lost. Board view (columns by stage) and list view. Moving to Lost needs a reason. Moving to Won stamps won-on and offers "Create project from this deal".

**F-SAL-03 Traceability.** Every stage change is kept (from, to, who, when). Each deal has an activity log: date, type (Call, Meeting, Demo, Email, Proposal, Follow-up), note, by. The deal page shows a single timeline of stage changes and activities. Deals with no activity in \[14\] days are flagged stale.

**F-SAL-04 Sales cost vs deals closed.** Period switch: month, quarter, year. For the team and per person: sales cost (base + earned variable), deals won (count and value), cost-to-revenue ratio, return on sales cost.

**F-SAL-05 Individual performance.** Per salesperson for the chosen period: target, achieved, % of target, variable earned (BR-15), deals won, win rate (won ÷ (won + lost)), average deal size, average days lead-to-won, activities logged, open pipeline value, stale deals.

**F-SAL-06 Compensation card.** For the month: base, variable at stake, target, achieved, variable earned (0 or full), total payout. Shown to the salesperson (own only) and admin (all).

**Acceptance:** a salesperson with ₹50,000 CTC and 20% variable has base ₹40,000 and variable ₹10,000. At 95% of target the month pays ₹40,000; at 100% it pays ₹50,000.

## 11. FSD: finance, payroll and CEO revenue dashboard

Revenue is the first thing the CEO sees on login. Finance data is admin-only by default.

**F-LED-01 Ledger.** Income and expense entries: kind, category, amount, date, recurring (monthly) with optional end date, status (expected / received / paid), note, linked project or milestone (optional). Milestone invoices create income entries automatically.

**F-LED-02 Invoice a milestone.** From a milestone: mark invoiced (amount, invoice no., date), then mark paid (date, amount received). Partial payments allowed. In v1 the invoice PDF is uploaded, not generated.

**F-PAY-01 Payroll run.** Admin picks a month and runs payroll. For each person: monthly base, working days, approved days, unapproved days with their weeks, LWP days, deduction (BR-12), sales variable earned (BR-15), net payout. Status: draft, then finalised (locked). Export to CSV for the bank or accountant.

**F-PAY-02 Payroll warnings.** Before finalising, list everyone with unapproved or unsubmitted weeks in the month, so the admin can chase approvals first.

**F-CEO-01 Revenue dashboard.** Period switch: month, quarter, financial year (April–March). Cards: billed, collected, total cost (salaries + expenses), net, each with change vs previous period. 12-month bar chart of billed vs collected vs cost. Revenue by stream (product, services, SaaS subscriptions, AMS, consulting). Revenue ahead: uninvoiced milestone values and weighted pipeline.

**F-CEO-02 Project health strip.** Count of projects by status, at-risk projects (projected margin below floor or effort ratio above 1.2), overdue milestones.

**Acceptance:** entering a ₹6,00,000 recurring monthly income from April shows ₹36,00,000 in the H1 period total and appears in each month's bar.

## 12. FSD: operations, insights, settings and notifications

**F-OPS-01 Operations register.** One list of internal work that is not client delivery: renewals, compliance filings, IT and admin items. Fields: item, category, owner, due date, recurring (monthly / quarterly / yearly), status, note. Overdue items surface on the owner's home and the CEO dashboard. Each screen has a one-line description of what it is for.

**F-OPS-02 Change requests.** Per project: title, requested by, effort hours, value, status (Raised, Estimated, Approved, Rejected, Done). Approved CRs add to contract value and can create a new milestone.

**F-OPS-03 Hiring openings.** Role, project, count, status, owner. Shown against allocation gaps.

**F-OPS-04 Leave register.** Per person: dates, type (paid / LWP / half day), source (timesheet or HR entry), approved by. Feeds working-day and payroll calculations.

**F-INS-01 Insights tab.** Ready-made views, no report builder in v1: tasks at risk (due in 3 days and not started), blocked by dependency, overdue milestones, effort ratio outliers, people under 80% or over 110% allocated, timesheet compliance by team, manager approval KPI ranking, stale deals.

**F-SET-01 Company settings.** Name, logo, financial year start, currency (INR), time zone, weekly off, Saturday rule, minimum hours, breaks count, approval SLA, margin floor, empty-milestone days, stale-deal days.

**F-SET-02 Holiday calendar.** Add holidays per year; import a CSV. Optional location-wise calendars (future scope).

**F-SET-03 Product list and categories.** Tenant-defined products (used by Sales), ledger categories, operations categories.

**F-NOT-01 Notifications.** In-app bell plus email for: mention, task assigned, timesheet submitted / approved / rejected / unlocked, unlock requested, approval overdue, milestone auto-deleted, deal stale. Each user can mute email per type.

## 13. Data model

All tables carry `id` (UUID), `tenant_id`, `created_at`, `created_by`, `updated_at`, `updated_by` unless noted. Money is stored as integer paise. Dates are stored as dates; timestamps in UTC and shown in tenant time.

| Table | Key fields | Notes |
| --- | --- | --- |
| tenants | name, plan, status (trial / active / read\_only / suspended), trial\_ends\_on, settings (JSON) | No tenant\_id; global |
| users | email, password\_hash, name, role, reports\_to\_id, grants (JSON), status | Unique email per tenant |
| holidays | date, name |  |
| cost\_rates | user\_id, monthly\_ctc, variable\_pct, sales\_target, effective\_from | History kept, never updated in place |
| projects | code, name, client, type, status, pm\_id, start, end, contract\_value, billing\_model |  |
| project\_status\_history | project\_id, from, to, reason, by, at | Append only |
| milestones | project\_id, no, name, planned\_start, planned\_end, billing\_amount, billing\_status, empty\_since, deleted\_at | Soft delete |
| tasks | project\_id, milestone\_id, no, title, owner\_id, backup\_id, est\_hours, start, due, complexity, status | wbs\_code derived |
| task\_dependencies | task\_id, depends\_on\_task\_id | No cycles |
| allocations | project\_id, milestone\_id, user\_id, pct, from, to | All mandatory |
| timesheet\_weeks | user\_id, week\_start, status, submitted\_at, approver\_id, decided\_by, decided\_at, late, reason, unlock\_until, unlock\_requested\_at | One per user per week |
| timesheet\_entries | week\_id, date, kind (task / leave / internal), task\_id, hours, note |  |
| leave | user\_id, date, type, source, approved\_by |  |
| delegations | from\_user\_id, to\_user\_id, from, to |  |
| comments | task\_id, body, mentions (user ids) |  |
| activity\_log | entity, entity\_id, action, before, after | Append only |
| deals | title, client, contact, phone, email, product, source, owner\_id, stage, value, mrr, expected\_close, won\_on, lost\_reason |  |
| deal\_stage\_history | deal\_id, from, to, by, at | Append only |
| deal\_activities | deal\_id, date, type, note, by |  |
| ledger\_entries | kind, category, amount, date, recurring, until, status, project\_id, milestone\_id, note |  |
| invoices | milestone\_id, number, date, amount, paid\_amount, paid\_on, file\_key |  |
| payroll\_runs | month, status, finalised\_by, finalised\_at |  |
| payroll\_lines | run\_id, user\_id, base, working\_days, approved\_days, unapproved\_days, lwp\_days, deduction, variable, net | Frozen when finalised |
| change\_requests | project\_id, title, hours, value, status |  |
| openings | role, project\_id, count, status, owner\_id |  |
| ops\_items | item, category, owner\_id, due, recurring, status |  |
| notifications | user\_id, type, payload, read\_at |  |

**Indexes that matter:** timesheet\_weeks (tenant\_id, user\_id, week\_start) unique; timesheet\_entries (tenant\_id, task\_id); tasks (tenant\_id, project\_id, milestone\_id); deals (tenant\_id, owner\_id, stage).

## 14. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Tenant isolation | PostgreSQL RLS on every tenant table; automated cross-tenant test suite must pass on every build |
| Security | HTTPS only; passwords hashed with Argon2 or bcrypt; login rate limit; optional 2FA for admins; OWASP Top 10 checked before launch |
| Permissions | Enforced in the API for every endpoint; salary and margin fields stripped from responses for users without the grant |
| Audit | Activity log for delivery data; append-only history for status, stage and payroll; admin actions and impersonation logged |
| Performance | Pages load under 2 seconds at 200 users and 3 years of timesheets per tenant; timesheet save under 500 ms |
| Availability | 99.5% monthly; daily database backups kept 30 days; point-in-time restore tested once before launch |
| Data residency | All data and backups in AWS Mumbai |
| Privacy (DPDP Act 2023) | Privacy policy and terms at signup; data export per tenant (CSV/JSON); tenant deletion within 30 days of request |
| Mobile | Timesheet, my tasks, approvals and dashboards usable on a 375 px phone screen |
| Browsers | Latest Chrome, Edge, Safari, Firefox |
| Accessibility | Keyboard navigable forms, visible focus, colour is never the only signal |
| Observability | Error tracking (e.g. Sentry), request logs, job failure alerts to the on-call developer |
| Calculations | All money and working-day logic lives in one tested backend module, never duplicated in the frontend |

## 15. Project plan: v1 scope

v1 ships in two releases. Release 1 is the smallest product a company will pay for: delivery, time, approvals and the pay rule. Release 1.1 brings the rest of the prototype. Nothing from Release 1.1 starts until Release 1 passes acceptance.

| Area | Release 1 (paid MVP) | Release 1.1 (prototype parity) |
| --- | --- | --- |
| Platform | Signup, tenant, invite, roles, RLS, trial, Razorpay subscription, super-admin basics | View as, bulk CSV invite, 2FA |
| Projects | List with status filters, create/edit, status change + history, types, milestones M1…, tasks, auto-numbering, WBS import | Gantt, auto-delete empty milestones, change requests |
| Tasks | Fields, my tasks, dependencies with block, comments with @mentions | Backup owner cover, daily update, full activity log UI |
| Timesheets | Week grid, one-row entry, save/submit, weekly lock, unlock request, approve/reject, approvals inbox, reminders | Team 8-week grid, delegation, manager approval KPI |
| Calendar | Settings, holidays, working-day engine | Location calendars (future) |
| Costing | Cost rates with history, allocation by milestone, planned vs actual margin per project | Projected margin, milestone-level margins, over-allocation warnings |
| Payroll | Approved-days payroll run with deductions and CSV export | Sales variable in payroll, finalise lock |
| Sales | — | Leads, pipeline, traceability, sales cost vs deals, individual performance, compensation |
| Finance and CEO | Revenue cards (month/quarter/FY) from milestone invoices | Ledger, recurring income, streams, 12-month chart, revenue ahead |
| Operations and Insights | — | Ops register, openings, Insights tab |

**Why this cut.** Release 1 is the core loop the prototype proved: plan work, log time, approve, pay for approved time, see margin. Sales CRM and finance ledger are useful but customers already have tools for them, so they do not block the first sale.

## 16. Project plan: future scope (not in v1)

These are deliberately out of v1. Any request for them during the build goes to the backlog, not the sprint.

- **Integrations:** Jira and Azure DevOps task sync, Google/Outlook calendar for leave, Slack/Teams notifications, Tally and Zoho Books export, WhatsApp reminders.
- **Payroll depth:** PF, ESI, TDS, professional tax, payslips, Form 16. v1 computes the payable amount only.
- **Invoicing:** GST invoice generation and e-invoicing from milestones (v1 uploads the invoice file).
- **Resource planning:** skills matrix, bench view, what-if allocation, capacity forecast.
- **Reporting:** custom report builder, scheduled email reports, exports to Google Sheets.
- **Client portal:** clients see milestone progress, approve deliverables and CRs.
- **Mobile apps:** native iOS/Android with offline timesheet (v1 is a responsive web app).
- **AI features:** WBS generation from a scope document, timesheet auto-fill from calendar and commits, margin risk prediction, weekly CEO summary.
- **Enterprise:** SSO (SAML/Azure AD), custom roles, multi-entity and multi-currency, location-wise calendars, dedicated database per tenant, SOC 2.
- **Marketplace:** public API with keys and webhooks.

## 17. Project plan: WBS by milestone

M1–M8 deliver Release 1; M9–M11 deliver Release 1.1. Owner codes: **BE** backend, **FE** frontend, **PM** project manager, **QA** tester (PM or a developer on rotation). A task is done only when its "Done when" is shown to the PM on staging.

### M1 Foundation

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 1.1 | Repos, branching rules, PR template, code owners | BE | Two repos (api, web) with protected main | — |
| 1.2 | AWS Mumbai setup: VPC, RDS PostgreSQL, S3, Redis, SES | BE | Staging and production environments reachable | 1.1 |
| 1.3 | CI/CD: tests, lint, deploy to staging on merge | BE | A merge deploys to staging automatically | 1.2 |
| 1.4 | FastAPI skeleton: config, DB migrations (Alembic), error format, OpenAPI | BE | /health and /docs live on staging | 1.3 |
| 1.5 | Tenant context + RLS policies + cross-tenant test harness | BE | Test proves tenant A cannot read tenant B | 1.4 |
| 1.6 | Next.js shell: layout, navy/blue theme from prototype, tabs, API client from OpenAPI | FE | Empty tabs render with role-based menu | 1.4 |
| 1.7 | Error tracking and logs | BE | A thrown test error shows in Sentry | 1.3 |

### M2 Accounts, roles and billing

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 2.1 | Signup creates tenant + admin + default settings | BE, FE | New company can sign up and log in | 1.5, 1.6 |
| 2.2 | Login, logout, refresh tokens, password reset, Google sign-in | BE, FE | All flows work; reset email arrives | 2.1 |
| 2.3 | Invite user with role and reports-to; accept invite | BE, FE | Invitee sets password and lands on their home | 2.2 |
| 2.4 | Permission layer + grants (margins, salaries) | BE | API test matrix per role passes | 2.3 |
| 2.5 | People screen: list, edit role, reports-to, deactivate | FE | Admin manages users without DB access | 2.4 |
| 2.6 | Trial, plans, Razorpay subscription + webhook, read-only on expiry | BE, FE | Test payment moves tenant to active | 2.1 |
| 2.7 | Super-admin console: tenants, plan, users, status | BE, FE | Seereon staff can extend a trial | 2.6 |

### M3 Calendar and settings

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 3.1 | Company settings screen (F-SET-01) | BE, FE | All settings save and reload | 2.4 |
| 3.2 | Holiday calendar with CSV import | BE, FE | Holidays greyed in timesheet | 3.1 |
| 3.3 | Working-day engine: weekly off, Saturday rule, holidays, leave | BE | Unit tests for BR-01 to BR-03 pass | 3.2 |

### M4 Projects, milestones and WBS

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 4.1 | Project CRUD, types, auto code | BE, FE | F-PRJ-02 acceptance passes | 2.4 |
| 4.2 | Project list, status chips with counts, search | FE | F-PRJ-01 matches prototype | 4.1 |
| 4.3 | Status change with reason + history | BE, FE | BR-17 tests pass | 4.1 |
| 4.4 | Milestones CRUD, auto-number, delete rules | BE, FE | BR-19, BR-21 tests pass | 4.1 |
| 4.5 | Inline add task under milestone | FE | Enter saves and opens next row | 4.4, 5.1 |
| 4.6 | WBS import: template, parse CSV/XLSX, preview, errors, transactional save | BE, FE | 40-row sample imports; a bad row blocks the whole import | 4.4, 5.1 |

### M5 Tasks and collaboration

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 5.1 | Task CRUD with all F-TSK-01 fields, WBS code | BE, FE | Task page shows code 2.3 | 4.4 |
| 5.2 | My tasks list | FE | Sorted by due, overdue red, blocked on top | 5.1 |
| 5.3 | Dependencies with cycle check and start block | BE, FE | F-TSK-03 acceptance passes | 5.1 |
| 5.4 | Comments with @mentions and notifications | BE, FE | Mentioned person gets bell + email | 5.1 |
| 5.5 | Activity log capture (UI in M11) | BE | Every write on project, milestone, task logged | 5.1 |

### M6 Timesheets and approvals

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 6.1 | Week and entry model + API | BE | Save and load a week | 5.1, 3.3 |
| 6.2 | Week grid with one-row entry and picker (tasks, leave, internal) | FE | F-TS-01, F-TS-02 match prototype on desktop and phone | 6.1 |
| 6.3 | Save and submit; leave sync to leave register | BE, FE | BR-05, BR-09 tests pass | 6.2 |
| 6.4 | Weekly lock job, unlock request, unlock window | BE, FE | BR-06 test passes via scheduled job | 6.3 |
| 6.5 | Approver resolution, auto-approve top person | BE | BR-07 tests pass | 6.3 |
| 6.6 | Approvals inbox, approve, reject with reason, bulk approve | BE, FE | F-TS-05 acceptance passes | 6.5 |
| 6.7 | Reminder emails (Friday, SLA overdue) | BE | Emails arrive on staging schedule | 6.6 |

### M7 Costing, margins and payroll

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 7.1 | Cost rates with effective-from history | BE, FE | Rate valid on a date is used | 2.4 |
| 7.2 | Allocation by milestone with mandatory dates | BE, FE | BR-22 enforced in API and UI | 4.4, 7.1 |
| 7.3 | Calculation module: cost/hour, planned cost, actual cost, margin, markup, effort ratio | BE | F-FIN acceptance numbers match to the rupee | 7.2, 6.6 |
| 7.4 | Margin panel per project (planned vs actual) | FE | Visible only with grant | 7.3 |
| 7.5 | Milestone invoice and payment recording | BE, FE | Invoiced milestone cannot be deleted | 4.4 |
| 7.6 | Payroll run: approved days, deductions, warnings, CSV | BE, FE | BR-12, BR-13 tests pass | 7.3, 6.6 |
| 7.7 | CEO revenue cards: month, quarter, FY from invoices | BE, FE | Totals match invoices entered | 7.5 |

### M8 Release 1 hardening and launch

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 8.1 | End-to-end tests for the core loop (plan → log → approve → pay → margin) | QA | Suite green on staging | M4–M7 |
| 8.2 | Security pass: OWASP checklist, cross-tenant suite, permission matrix | BE, QA | No open high findings | 8.1 |
| 8.3 | Performance test at 200 users, 3 years of data | BE | NFR targets met | 8.1 |
| 8.4 | Backups and restore drill | BE | Restore to a new DB proven | 1.2 |
| 8.5 | Privacy policy, terms, data export | PM, BE | Linked at signup; export downloads | 2.1 |
| 8.6 | Onboarding: sample data option, help text per screen, first-login checklist | FE, PM | New tenant reaches first approved week unaided | 8.1 |
| 8.7 | Migrate Seereon from the prototype board as tenant #1 | BE, PM | Seereon runs payroll on the new product | 8.1 |
| 8.8 | Production launch and pilot with 2–3 friendly companies | PM | Pilots signed up and logging time | 8.2–8.7 |

### M9 Sales CRM and compensation (Release 1.1)

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 9.1 | Deals, manual lead form, product and source lists | BE, FE | F-SAL-01 matches prototype | M8 |
| 9.2 | Pipeline board and list, stage history, lost reason, won → project | BE, FE | Every move recorded | 9.1 |
| 9.3 | Activities and deal timeline, stale flag | BE, FE | F-SAL-03 acceptance passes | 9.2 |
| 9.4 | Compensation engine (BR-14 to BR-16) and card | BE, FE | F-SAL-06 acceptance passes | 9.2, 7.1 |
| 9.5 | Sales cost vs deals closed by period; individual performance | BE, FE | F-SAL-04, F-SAL-05 numbers match a hand calc | 9.4 |
| 9.6 | Variable pay into payroll run, payroll finalise lock | BE | Payroll line shows earned variable | 9.4, 7.6 |

### M10 Finance, CEO dashboard, operations and insights (Release 1.1)

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 10.1 | Ledger with recurring entries and categories | BE, FE | F-CEO acceptance passes | M8 |
| 10.2 | Full CEO dashboard: streams, 12-month chart, revenue ahead, project health | BE, FE | Matches prototype CEO view | 10.1, 9.2 |
| 10.3 | Projected and milestone-level margins, over-allocation warnings | BE, FE | F-FIN-04 fully live | 7.3 |
| 10.4 | Operations register, change requests, openings | BE, FE | F-OPS-01 to 03 live | M8 |
| 10.5 | Insights tab views (F-INS-01) | BE, FE | Each view lists correct items on seed data | 10.3, 6.6 |
| 10.6 | Manager approval KPI, team 8-week grid, delegation | BE, FE | F-TS-06, 07, 09 acceptance passes | 6.6 |

### M11 Parity polish and Release 1.1

| WBS | Task | Owner | Done when | Depends on |
| --- | --- | --- | --- | --- |
| 11.1 | Gantt view with dependencies and critical dates | FE | F-PRJ-08 matches prototype | 5.3 |
| 11.2 | Empty-milestone auto-delete job | BE | BR-20 test passes | 4.4 |
| 11.3 | Backup owner cover, daily update, activity log UI | BE, FE | F-TSK-04, 06, 07 live | 5.5 |
| 11.4 | View as, bulk CSV invite, 2FA for admins | BE, FE | F-PLT-04 live | 2.4 |
| 11.5 | Regression, security re-check, release | QA, PM | Release 1.1 on production | 11.1–11.4 |

## 18. Team, acceptance, risks and open questions

**Team and responsibilities**

| Role | Count | Owns |
| --- | --- | --- |
| Product owner (Santosh) | 1 | Business rules, scope calls, acceptance sign-off per milestone |
| Project manager | 1 | WBS tracking, daily stand-up, staging demos, QA rotation, pilot customers |
| Backend developer | 2 | API, database, RLS, jobs, calculations, billing, infrastructure |
| Frontend developer | 1 | All screens, responsive layout, API client |
| AI pair (Claude) | — | Writes first drafts of endpoints, screens and tests from this FSD; reviews PRs; developers own every merged line |

**Ways of working**

- Each FSD item (F-xxx) and business rule (BR-xx) is a ticket; the ticket links back to this document.
- No merge without tests for the rule it implements and a passing cross-tenant suite.
- The PM demos each milestone on staging to the product owner; the milestone closes only on sign-off.
- Scope changes go to the backlog and are decided by the product owner at milestone boundaries.

**Release 1 is accepted when**

- [ ] A new company signs up, pays by Razorpay test mode and invites 5 users.
- [ ] A PM imports a WBS, allocates people by milestone and sets cost rates.
- [ ] Employees log a week on a phone; a manager approves and rejects with reasons.
- [ ] An unsubmitted week locks, is unlocked on request and resubmitted.
- [ ] Payroll for the month deducts exactly the unapproved days per BR-12.
- [ ] Project margin shows planned vs actual matching a hand calculation.
- [ ] The cross-tenant suite passes and no high security findings are open.
- [ ] Seereon runs its own month on the product instead of the prototype.

**Risks and mitigations**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Scope creep from the prototype's many features | Release 1 never ships | Release 1 list is frozen; everything else is Release 1.1 or backlog |
| Tenant data leak | Loss of trust, legal exposure | RLS in the database plus automated cross-tenant tests on every build |
| Money logic bugs | Wrong salaries paid | One calculation module, rule-by-rule tests, payroll stays draft until admin finalises |
| AI-generated code nobody understands | Slow fixes later | Developers review and own every PR; tests required; small PRs |
| Weak adoption of timesheets by users | Data is empty, dashboards useless | Fast phone entry, reminders, the pay rule itself as the incentive |
| Payroll compliance expectations | Customers expect PF/TDS | State clearly in sales and in-app that v1 computes payable amount only |

**Open questions for the product owner**

- [ ] Pricing: per active user per month, and the trial length?
- [ ] Is the "no pay for unapproved days" rule on by default for every tenant, or a setting? (Labour-law review advised before selling it as default.)
- [ ] Brand name for the SaaS product: Seereon Delivery Board or a new name?
- [ ] Which 2–3 pilot companies, and who is the contact at each?
- [ ] Do managers need approval by project (PM approves time on their project) as well as by reporting line?
- [ ] Should sales variable be paid monthly or accumulated quarterly?
