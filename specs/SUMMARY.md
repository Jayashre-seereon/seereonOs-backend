# SeereonOS (Seereon Delivery Board) — Frontend Summary

Sources: technical-design.md (wins on IDs), brd-fsd.md, debt-register.md, feature-guide.md, PROTOTYPE.md (prototype formulas, wording).

Multi-tenant SaaS for Indian IT services / SAP consulting companies (10–200 people). Every hour links task → milestone → project → cost → invoice. Buyer = founder/CEO.

## API conventions (mock layer must mimic)
- Lists: `{items,total,page,page_size}`; `?page,page_size(50,max 200),sort`.
- Errors: `{error:{code,message,field}}`; 400/401/402(TENANT_READ_ONLY)/403/404(also cross-tenant)/409(conflict, rule)/422/429(LOGIN_LOCKED). Non-blocking `warnings[]`.
- Writes carry `If-Match: version`; mismatch → 409 STALE.
- Money = integer paise. Frontend formats only (₹1,20,000; compact ₹1.2L). Calcs in domain module (server in real build).
- `GET /me` → user, role, grants, tenant, plan status, allowed tabs.
- View as: `X-View-As` header on GETs; writes 403 while set; read-only banner.
- Salary/margin fields stripped without grant.
- Notifications polled every 30s.

## Roles
admin(CEO), pm, sales, ops, employee. Super admin (SA) outside tenants: tenant list, extend trial (1–30d), suspend; never sees tenant business data. Grants: can_see_margins, can_see_salaries. One reports_to per user = timesheet approver. Top person auto-approved. Each role lands on its own dashboard.

| Resource/action | Admin | PM | Sales | Ops | Employee |
|---|---|---|---|---|---|
| Settings, holidays edit | Y | N | N | N | N |
| Users invite/role/deactivate | Y | N | N | N | N |
| Projects create | Y | Y | N | N | N |
| Projects/milestones/WBS edit, status | Y | Own | N | N | N |
| Projects view | All | All | Linked to own deals | All | With own tasks |
| Tasks create/edit/delete | Y | Own projects | N | N | N |
| Task status | Y | Own projects | N | N | Own tasks |
| Comments | Y | Own projects | N | N | Visible tasks |
| Timesheet log/submit | Own | Own | Own | Own | Own |
| Approve/reject/unlock | All | Reports | Reports | Reports | Reports if manager |
| Leave HR entry | Y | N | N | Y | N |
| Cost rates, salaries | Y | Grant | N | Grant | N |
| Allocation | Y | Own projects | N | N | N |
| Margins | Y | Grant | N | N | N |
| Invoices/payments/ledger/revenue | Y | N | N | View ledger | N |
| Payroll | Y | N | N | N | N |
| Deals create/edit/move | Y | N | Own | N | N |
| Sales performance/pay | All | N | Own | N | N |
| Ops register, openings | Y | Openings | N | Y | N |
| Insights | All | Own projects+team | Sales views | Ops views | N |
| Billing, data export | Y | N | N | N | N |
Read-only tenant: billing only; else 402.

## Screens
UI-01 /signup (company,name,email,password → tenant+14d trial → onboarding) · UI-02 /login (5 fails/15min lock 15min) · UI-03 /reset-password (request always 202; token 60min) · UI-04 /invite/:token (company+role; set name+password; 7d) · UI-05 /people (table; invite; role, reports-to, grants; deactivate) A · UI-06 /settings/company all settings w/ inline help A · UI-07 /settings/holidays year view, add, delete, CSV import(date,name) A · UI-08 /projects list, status chips w/ counts, search, inline status change, +Create · UI-09 project create/edit dialog; status reason dialog A,P · UI-10 /projects/:id header; milestones M1.. with tasks 1.1..; edit/delete milestone; inline +Task row (Enter saves); status history · UI-11 /projects/:id/import WBS upload/paste; template; preview with row errors; all-or-nothing commit · UI-12 /my-tasks open by due; overdue red; blocked on top; Covering list · UI-13 task drawer: fields, status, dependencies with blocking callout (task+owner), comments with @mentions · UI-14 bell: unread count, list, mark read, jump · UI-15 /timesheet/:week week grid; one empty picker row; day totals; save; submit; locked/rejected states; unlock request · UI-16 /approvals pending weeks (hours, days below min, days waiting, overdue badge); approve; reject w/ reason; bulk approve; unlock 1–7 days · UI-17 /settings/cost-rates CTC, variable %, target; effective-from history · UI-18 /projects/:id/allocation person, milestone, %, from, to (all required); over-allocation warnings · UI-19 margin panel: planned vs projected vs actual; margin & markup side by side; red below floor (A or grant) · UI-20 milestone invoice dialog: number, date, amount, file; record payment (partial ok, no overpay) · UI-21/32 /home CEO: revenue cards month/quarter/FY with change; 12-month chart; streams; revenue ahead; project health · UI-22 /payroll month; run; warnings; lines; recompute while draft; finalise; CSV · UI-23 /billing plan, seats, renewal; Razorpay checkout · UI-24 /admin (SA) tenant list; extend trial; suspend · UI-25 onboarding checklist (settings, holidays, invite, first project, first week; sample data) · UI-26 /settings/data export (link 24h), /privacy, /terms · UI-27 /sales kanban (drag; confirm on Lost) + list · UI-28 /sales/new, /sales/:id lead form; timeline of stage changes & activities; create project when won · UI-29 /sales/performance period switch; per-person metrics; cost vs closed · UI-30 /sales/compensation base, variable at stake, target, achieved, payout · UI-31 /finance/ledger entries; recurring toggle + end date; filters · UI-33 /operations ops register due/overdue; Mark done rolls recurring forward · UI-34 /projects/:id/change-requests list; raise; decide (approval adds value, can create milestone) · UI-35 /openings · UI-36 /insights 8 views as tabs · UI-37 /team 8-week grid; approval KPI · UI-38 /settings/delegations (no overlaps) · UI-39 /projects/:id/gantt bars, dependency arrows, today line, critical path · UI-40 daily update (proof link required), activity log, covering · UI-41 View as, bulk CSV invite, 2FA TOTP setup.
Prototype extras with no UI id (include): schedule & critical-path breach list with one-click actions, PM delivery-control strip, resource load next 10 working days, P50/P80 predictions, estimation accuracy, weekly scorecard, money-free client view, monthly P&L, SPI.

## Business rules
BR-01 working day = not weekly off, not holiday, not person's approved leave. BR-02 weekly off Sunday; Saturdays all_on/all_off/some_off [2nd,4th]. BR-03 min hours/day 9, breaks count. BR-04 timesheet = one person, Mon–Sun week; statuses open, submitted, approved, rejected, locked. BR-05 save draft anytime; submit; read-only after submit. BR-06 unsubmitted week locks when it ends (Mon 00:00); approver/admin unlock for a window; person can request unlock with reason. BR-07 approver = reports_to or active delegate; top person auto-approved. BR-08 reject needs reason (≥5 chars); reopens. BR-09 leave in timesheet creates leave record and vice versa. BR-10 approval SLA 2 working days. BR-11 late approvals and pending past SLA count against manager (negative KPI), never block. BR-12 pay only for approved days: deduction = base ÷ working days in month × (unapproved + LWP days). BR-13 day unapproved if week not approved at run time; each deduction shows source week. BR-14 sales pay = base + variable; variable 20% of CTC; target = monthly CTC. BR-15 variable paid only when achieved ≥100% of target (no partial). BR-16 achieved = value of deals won that month owned by person. BR-17 project statuses Initiated, Active, On hold*, NPA*, Completed, Closed* (*reason); history kept. BR-18 types Product, Service, SaaS, AMS. BR-19 milestones M1.., tasks numbered in milestone, WBS code 2.3, never reused. BR-20 milestone empty 7 days auto-deleted unless invoiced. BR-21 invoiced milestone undeletable; deleting moves tasks to "No milestone". BR-22 allocation needs milestone, start, end. BR-23 cost/hour = monthly CTC ÷ (working days × min hours). BR-24 margin% = (rev−cost)/rev; markup% = (rev−cost)/cost; margin default display. BR-25 planned (estimates+allocation), projected (actual to date + remaining estimate), actual (approved hours + invoiced revenue). BR-26 effort ratio = actual/estimated; >1.2 flagged. BR-27 billed on invoice raise, collected on payment.
Also: task can't go In progress while a dependency is open; cycles rejected. Backup owner covers on owner leave. Cost uses rate valid on work date. Warn if allocation >100%/day. Deal Lost needs reason; Won stamps date, offers create project; only admin moves out of Won/Lost. Deal stale after 14 days no activity. Invoices create ledger income rows (undeletable in ledger). pay.deduct_unapproved_days default off (on for Seereon). Project codes auto PRJ-014.

## Lifecycles
Tenant trial(14d)/active/read_only/suspended. Project status above; health On track / At risk / Off track (at risk = projected margin < floor or effort ratio >1.2). Billing model fixed/T&M/subscription/AMS retainer. Milestone billing none/invoiced/paid; delivery Achieved on time/late, On track, At risk, slip +Nd. Task To do/In progress/Blocked/In review/Done; complexity low/medium/high. Timesheet open→submitted→approved|rejected; open→locked at Mon 00:00; locked may carry unlock request; unlocked until unlock_until. Entry kind task/leave/internal(note req). Leave paid/lwp, full/half, source timesheet/hr, types casual, sick, earned, compensatory, LWP. Deal Lead/Qualified/Demo/Proposal/Negotiation/Won/Lost; sources Referral,BNI,Website,Cold call,Event,Partner,Other; activities Call,Meeting,Demo,Email,Proposal,Follow-up. Invoice partial → paid. Payroll draft→final. Ledger income/expense, expected/received/paid, monthly recurring until end. Change request Raised/Estimated/Approved/Rejected/Done. Ops item recurs monthly/quarterly/yearly.

## Settings (key: default, range)
company.name; company.logo; company.time_zone Asia/Kolkata; company.fy_start_month 4; company.currency INR; calendar.weekly_off [Sun]; calendar.saturday_rule some_off; calendar.saturday_off_weeks [2,4]; calendar.min_hours_per_day 9 (1–12, .5); calendar.max_hours_per_day 16 (8–24); calendar.breaks_count yes; timesheet.hours_step 0.5 (0.25/0.5/1); timesheet.allow_future_entries no; timesheet.internal_note_required yes; timesheet.weekly_lock yes; timesheet.unlock_max_days 7 (1–14); approval.sla_working_days 2 (1–10); approval.bulk_approve yes; pay.deduct_unapproved_days no; pay.variable_default_pct 20 (0–50); pay.target_default ctc; pay.variable_threshold_pct 100 (80–120); projects.code_prefix PRJ; projects.empty_milestone_days 7 (0–60); projects.margin_floor_pct 25; projects.effort_ratio_alert 1.2; allocation.max_pct_per_person 100 (50–150); allocation.block_over no; daily.proof_required yes; sales.stale_deal_days 14; notify.friday_nudge_time 16:00; notify.sla_digest_time 09:30; security.password_min_length 10; security.lockout_attempts 5; security.lockout_minutes 15; security.session_idle_minutes 60; security.require_2fa_admins no.
Fixed validations VAL-F01..28 with codes: USER_EMAIL_TAKEN, USER_REPORTS_LOOP, LAST_ADMIN, TS_BAD_WEEK, TS_BAD_HOURS, TS_NOT_EDITABLE, TS_REASON_REQUIRED, TS_SELF_APPROVAL, TS_TASK_NOT_ALLOWED, TS_PROJECT_CLOSED, BR_17_REASON_REQUIRED, DATE_RANGE, MS_INVOICED, DEP_CYCLE, TASK_BLOCKED, TASK_HAS_HOURS, ALLOC_INVALID, RATE_PERIOD_LOCKED, INV_OVERPAY, INV_NUMBER_TAKEN, PAY_FINAL, MONEY_INVALID, DEAL_STAGE, FILE_REJECTED, WBS_INVALID, STALE, TENANT_READ_ONLY, LEAVE_INVALID. Configurable: TS_BELOW_MIN(warn), TS_OVER_MAX, TS_BAD_STEP, TS_FUTURE, TS_NOTE_REQUIRED, TS_LOCKED, TS_UNLOCK_RANGE, TS_BULK_OFF, DU_PROOF_REQUIRED, MARGIN_BELOW_FLOOR(warn), ALLOC_OVER(warn|block), PASSWORD_WEAK, LOGIN_LOCKED.

## Formulas
Cost/hour = CTC ÷ (working days × min hours) (₹60,000 ÷ (22×9) = ₹303.03). Planned cost = Σ est hours × owner rate. Projected = actual cost + remaining est × rate. Actual = approved hours × rate vs invoiced. Effort ratio = actual ÷ est. SPI = earned ÷ planned by today. On-time = share of tasks done by due. Payroll: deduction = base ÷ working days × (unapproved + LWP), half day 0.5; net = base − deduction + variable. Comp: base = CTC×(1−v%), variable = CTC×v%, target = CTC, variable full only ≥100%. Win rate = won ÷ (won+lost). Weighted pipeline = Σ value × stage chance. SLA due skips offs/holidays. Approval KPI = −(late + overdue pending). FY Apr–Mar; 28 Sep 2026 = Q2 FY26-27.

## Notifications
NTF-01 reset, 02 invited, 03 mentioned, 04 TS submitted, 05 approved, 06 rejected, 07 unlock requested, 08 unlocked, 09 Friday nudge 16:00, 10 approvals-overdue digest, 11 trial ends in 3 days, 12 deal stale, 13 ops item due, 14 task assigned, 15 milestone auto-deleted, 16 payment failed, 17 export ready.

## Dashboards
CEO: revenue month/quarter/FY + net FY with change; period table billed/collected/cost/net/margin; 12-month billed vs collected; revenue by stream (SAP consulting, products, services, SaaS, AMS); revenue ahead (uninvoiced milestones + weighted pipeline); project health strip; delivery (milestones on time, SPI, overdue tasks); milestones due next 30 days.
Insights 8: tasks at risk (due ≤3d not started), blocked, overdue milestones, effort ratio >1.2, people <80% or >110% allocated, timesheet compliance 8 weeks, approval KPI ranking, stale deals.
Sales: open value, weighted, win rate, days to close, funnel, 30-day activity, cost vs closed, per-person metrics, 6-month target vs achieved.
Finance: payroll, ledger, 6-month P&L, margin panel.
