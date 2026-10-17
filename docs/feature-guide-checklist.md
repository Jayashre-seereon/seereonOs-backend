# Feature Guide checklist (Seereon Delivery Board, 28 Sep 2026)

## 1. Roles and views
- G1.01 Header: company name, week switcher (prev/next week arrows, "This week" label) that drives the week shown on dashboards/timesheet/scorecard
- G1.02 Tabs visible per role
- G1.03 View as (admin): switch to any role, read-only
- G1.04 Five dashboard views CEO / PM / Sales / Operations / Employee; each role lands on its own; employee cannot open others; CEO can switch between the 5 dashboards (segmented switch) and CEO dashboard has sub-tabs Overview / Projects / Sales / Finance / Operations
- G1.05 Role matrix: PM sees own projects, tasks, allocation, approves team timesheets, no salaries/payroll/finance (margins only if granted); Sales own leads; Ops register, openings, leave entries; Employee own tasks' status, own timesheet, comments
- G1.06 Employee view: person picker (for CEO/PM), "Tagged you" list (mention comments with Open task), "Covering" tasks for colleagues on leave, own numbers: this week's score, on-time delivery, effort ratio, utilisation next 10 working days, + more (open tasks, avg lateness, overdue, etc.)

## 2. CEO dashboard
- G2.01 Top 4: revenue this month, quarter, FY (Apr–Mar), net earnings FY, each with change arrow vs previous period
- G2.02 Period table: billed, collected, costs (salaries + expenses), net earnings, net margin, revenue change for month/quarter/FY
- G2.03 12-month chart billed vs collected
- G2.04 Revenue by stream (SAP consulting, project milestones/products, services, subscriptions/AMC, AMS) with % share
- G2.05 Revenue ahead: milestones billable in 30/60/90 days + weighted sales pipeline
- G2.06 Delivery KPIs: on-time delivery, avg SPI, avg CPI, utilisation next 10 days, active projects in red, open tasks already breached, tasks forecast to breach, tasks done last 4 weeks (vs previous 4), team weekly score
- G2.07 Milestones and cash: milestones achieved on time %, achieved-not-invoiced ₹, invoiced-awaiting-payment ₹, billable next 30 days; table of milestones due in 30 days with deadline, forecast, status, billing
- G2.08 Footnote definitions of revenue / costs / net earnings

## 3. Projects list
- G3.01 Status chips All/Initiated/Active/On hold/NPA/Completed/Closed with counts, filter
- G3.02 Status/health column: health badge (On track/At risk/Off track) + inline status dropdown
- G3.03 Moving to On hold / NPA / Closed requires reason; status history kept
- G3.04 Columns: PM, commercial model (Fixed / T&M), type, progress (% and x/y tasks), planned end, forecast end (red when late, "+Nd late"/"Nd early"), next milestone (Mx date name), contract value, projected margin
- G3.05 Expand row inline (click again to close)
- G3.06 Project types Product / Service / SaaS / AMS
- G3.07 Create project form: name, client, PM, start, planned end, working-days/weekends/holidays summary for the date range, type, commercial model, priority (1..n with labels), auto project code
- G3.08 AUTO MILESTONE SETUP in create form: milestones one per line "name | billing amount" → M1..Mn created in order with billing amounts
- G3.09 Documents upload in create form (PDF, images, text, CSV up to 20 MB each)
- G3.10 PROJECT COST CALCULATOR in create form (editors only): Resources rows (resource, milestone or All, alloc %, from*, to* default to milestone dates, working days, man-days, cost/day, cost, remove), same person multiple rows; Additional costs (category, description, amount); Maintenance/support cost; Contingency % of resources+additional; Markup %; Project price (computed both ways); planned margin; totals
- G3.11 Cost per day = CTC ÷ average working days per month × (1 + cost loading %); cost loading set in Finance

## 4. Project page: milestones, tasks, WBS
- G4.01 Milestones numbered M1.. in creation order; tasks 2.1, 2.2; numbers never change / never reused
- G4.02 Milestone deadline = target end of its last task (auto); baseline date shown; slip shown in red (+5d)
- G4.03 Milestone status: Achieved on time / Achieved late / On track / At risk; End column (actual achieved or forecast)
- G4.04 Milestone progress bar %, task count
- G4.05 Billing per milestone: amount + state dropdown (Not due / Invoiced / Paid); summary line paid / invoiced-unpaid / achieved-not-invoiced of total
- G4.06 Edit milestone (name, dates, amount); Delete blocked if invoiced; deleting moves tasks to "No milestone"
- G4.07 Auto-cleanup: milestone with no tasks for 7 days removed automatically unless invoiced
- G4.08 Add milestone inline: name + optional billing amount
- G4.09 WBS table: milestone rows with rollups (done %, effort est/actual, start, target end, end) and +Task per milestone; task rows: number, title, "after x.y" dependencies, owner, done %, effort est/actual, start plan/actual, target end (with revisions), end actual/forecast (green/red), float to milestone; critical tasks marked
- G4.10 WBS import: paste rows or upload CSV (Milestone, Task, Owner, Estimated hours, Start, End, Complexity, Depends on, Milestone billing); template download; preview with row errors (unknown owner, bad date, unknown dependency); all-or-nothing save

## 5. Schedule, critical path, change requests
- G5.01 Gantt: bar per task grouped by milestone, planned vs actual/forecast bars, critical in red, milestone deadline and forecast diamonds, today line, baseline
- G5.02 Critical path text summary (chain with dates, end date)
- G5.03 Critical path and breach risks list: each at-risk task with status, risk badges (Breached / High risk / Critical), project/milestone/owner/complexity/est/logged/backup, planned vs actual, waiting on / blocks with owners and dates, forecast vs target; actions: status dropdown, Update progress, Flag slip, Reassign, Details and comments (count), Remove
- G5.04 Change requests: KPIs raised, awaiting decision, approved extra effort hours, scope growth vs baseline %; CR rows (CR-n title, status, requested by, date, effort, working-days impact, billable value, note); Approve / Reject; approved CR adds value to contract and "Add its tasks to the WBS"; raise CR form

## 6. Costing, allocation, margins
- G6.01 Resource allocation by milestone (person, milestone or All, %, from, to all required)
- G6.02 Cost per hour = CTC ÷ (working days × min hours) example
- G6.03 Costing & margin table: Planned / Projected / Actual to date for revenue, cost, profit, margin (projected revenue incl CRs, actual earned = contract × % complete)
- G6.04 Margin vs markup shown side by side
- G6.05 Effort ratio per task, milestone, project; >1.2 flagged
- G6.06 What moved the margin: planned profit, approved CRs, breach cost (people held on late milestones), early-finish saving, projected profit; contingency note (released at close)
- G6.07 Milestone variance: deadline, forecast/actual, slip (working days), planned cost, projected cost, change
- G6.08 Resources: allocated vs logged (allocated man-days, allocated to date, logged days to date, allocation used %, planned cost; "unplanned" for people who logged without allocation)
- G6.09 Planned costing summary (calendar days, weekend days, holidays, working days, total man-days, resource count) + editable resource rows on the project
- G6.10 CEO profit-margins table across projects: contract, planned margin, projected margin (+pts), actual to date, projected profit, cost to date, projected cost; KPIs contract value, projected gross profit, projected gross margin, actual margin to date; drill into project
- G6.11 Margins visible only to CEO and margin-permission holders

## 7. Tasks
- G7.01 Tasks tab with filters by person, project, status
- G7.02 One owner + optional backup; on owner's leave days the task appears in backup's "Covering" list and backup can log time
- G7.03 Estimated hours, start, due, complexity (low/medium/high/very high) feeding estimation accuracy
- G7.04 Status: New, Selected for development, In development, Unit testing, Functional testing, UAT, Waiting for feedback, On hold, Blocked, Completed (guide summary To do / In progress / Blocked / In review / Done); moving to testing stage raises progress to ≥60/75/90%; progress %
- G7.05 Depends on: cannot start while a dependency is open; names blocking task and owner
- G7.06 Thread comments with @mentions → notification + "Tagged you" on dashboard
- G7.07 Task kind tag e.g. Bug

## 8. Timesheet and daily update
- G8.01 Weekly timesheet Mon–Sat for header week; holidays/weekly offs greyed and labelled
- G8.02 Always one empty row; pick task/activity (+ project for activities) + note; new empty row appears; rows with no hours disappear; sections Tasks / Activities
- G8.03 Day total vs minimum (9h) with short days highlighted; week summary "logged / target to date / %"
- G8.04 Quick rows: + Leave or holiday (full day marks leave; half day allowed), + Lunch, tea and stand-up, Copy rows from last week
- G8.05 Save draft; Submit for approval → read-only
- G8.06 Weekly lock banner with deadline; locks when week ends; unlock only by manager/CEO for N days after request with reason
- G8.07 Task hours become actual hours and cost
- G8.08 End-of-day update: date, what I finished, proof link (required), blockers
- G8.09 Friday demo: showed working software checkbox + what was demoed

## 9. Approvals & approval KPI
- G9.01 Submitted weeks go to reports-to manager; 2 working-day deadline (setting)
- G9.02 KPI strip: approvals on time last 30 days %, approval lapses (negative KPI), overdue now, waiting within deadline
- G9.03 Waiting list: person, submitted date, week, hours by day (short days red), total + short-day count, due by (overdue red), Approve, Reject with reason inline
- G9.04 My team's timesheets: 4 weeks per person coloured by status (Approved/Submitted/Locked/Draft), Unlock action
- G9.05 Delegation of approvals for a date range; delegate's approvals count to delegate's KPI
- G9.06 Top person (no manager) auto-approved

## 10. Payroll
- G10.01 Month picker + Calculate/Recalculate
- G10.02 KPIs: monthly CTC all staff, deductions (unapproved days, LWP days), sales variable earned, net payable
- G10.03 Per person: working days, approved, pending, not approved, LWP, CTC, base, deduction, variable, net payable, approver name / self-approves
- G10.04 Deduction = base ÷ working days × (unapproved + LWP)
- G10.05 Sales variable only when month target met
- G10.06 Flag people with unsubmitted/unapproved weeks before paying
- G10.07 CSV export for bank/accountant
- G10.08 Deduct-unapproved-days is a company setting (off by default for new tenants); PF/ESI/TDS out of scope

## 11. Sales
- G11.01 New lead form: opportunity, company/school, contact, phone, email, product, source (referral, BNI, website, cold call, event, partner), owner, stage, one-time value, recurring ₹/month, expected close, next step + by date, how the lead came in
- G11.02 Pipeline KPIs: open pipeline (n deals), weighted pipeline, won this quarter (n), forecast to close this quarter, win rate last 180 days, avg deal size (won), median sales cycle, recurring revenue won per month, new leads this month, activities this week, follow-ups overdue, deals no activity 14 days
- G11.03 Funnel by stage Lead/Qualified/Demo done/Proposal sent/Negotiation/Won (+Lost) with value and count
- G11.04 Lost requires reason; Won records date and can create project
- G11.05 Activity log last 30 days filterable by person: date, who, deal (+company), what (email/WhatsApp/call/stage/meeting/new lead), detail
- G11.06 Stale deal flag after 14 days without activity
- G11.07 Every deal traceable: created by, stage history, activities

## 12. Sales cost, performance, pay
- G12.01 Month / Quarter / Year switch + period picker
- G12.02 KPIs: sales salaries (people), deals closed, closed ÷ salary cost %, payout (base + variable earned)
- G12.03 Per salesperson: CTC in period, variable % (editable), monthly target (editable, default CTC), target in period, closed (deals won listed), achieved %, variable earned, payout, Save; Team total row
- G12.04 Variable only at 100% target (month by month; quarter/year = sum of monthly)
- G12.05 Trend by month: sales salary cost, payout, deals closed, closed ÷ salary
- G12.06 Deal value = one-time + 12 × recurring
- G12.07 Salesperson performance table: activities, calls, meetings, demos, proposals, new leads, won (value), lost, win rate, avg deal, sales cycle, open pipeline
- G12.08 Last 6 months per person: activities, new leads, deals closed bar, target, achieved, variable earned

## 13. Finance
- G13.01 Monthly P&L last 6 months: billed, collected, payroll, other costs, net
- G13.02 Ledger: income/expense entries outside milestones with category, amount, recurring monthly until end date, status (received / awaiting payment), Remove, Add entry
- G13.03 Milestone invoices add income automatically
- G13.04 Cost loading % setting (Finance) used in cost per day

## 14. PM & Operations dashboards
- G14.01 Delivery control: active projects, critical-path tasks at risk, blocked/on hold/waiting, tasks past planned start not started, open bugs, in unit/functional testing, in UAT with client, waiting for feedback, tasks without estimate, scheduling conflicts
- G14.02 Task pipeline: count per status bar chart
- G14.03 Resource load next 10 working days: booked hours vs capacity per person (%), over 100% double-booked
- G14.04 Operations: recurring duties KPIs (done on time last 90 days, overdue now, due next 10 days, responsibilities tracked); due & overdue list with category, frequency, owner, due date, period, Mark done rolling to next date
- G14.05 Ops other tabs: people & timesheet status, payroll, invoicing & collections, each with a one-line description

## 15. Insights, scorecard, client view
- G15.01 Delivery predictions per project: planned end, P50, P80, at current pace (velocity, h/week lately), chance on time; % done, hours left
- G15.02 Milestone predictions: deadline, P50, P80, chance on time, billing at stake
- G15.03 Tasks most likely to slip: owner + backup, target, P50, P80, chance on time
- G15.04 Estimation accuracy by complexity and by person: tasks, typical ratio, P80 ratio, on time %, action (add X% / sound); estimates checked in task form
- G15.05 Weekly scorecard: team score + green/amber/red counts; per person score with Delivery, Updates, Timesheet, Demo, Early warning, Approvals components; flags ("Red two weeks running: 1:1 due", "N tasks forecast to breach")
- G15.06 Client view: project picker, money-free status report (date, % complete, forecast vs planned), milestones (target, status), completed last 2 weeks, coming next 2 weeks, decisions needed from client; Download report for the client

## 16. Team and settings
- G16.01 Team table: name, role/title, function, joined, reports to (self-approves), access level (auto by role), productive hours/day, monthly CTC (CEO only)
- G16.02 Working hours & calendar: min hours/day, breaks count, weekly off days, Saturday rule + which Saturdays, manager approval deadline, avg working days/month shown
- G16.03 Holiday calendar
- G16.04 Leave: record leave for person & date range, list with Remove; leave taken this FY by type (casual, sick, earned, comp off, half day, LWP, optional holiday); timesheet leave rows sync
- G16.05 Delegations: from, to, scope (all projects/one project), dates, note; delegate sees tasks; covering shown
- G16.06 All settings in one place with default and allowed range

## 17. Rules & KPI definitions
- G17.01 Rules tab: non-negotiable working rules, how weekly score is built, how schedule forecast works, consequences
- G17.02 KPI definitions table (on-time, effort ratio, markup vs margin, sales variable, task statuses, critical task, working days, resource allocation, resource cost, milestone deadline, % complete, SPI, CPI, schedule variance, utilisation, timesheet, scope growth, baseline variance, markup, planned/projected/actual margin, P50/P80, performance trend, gross margin, net margin, DSO, runway, win rate, approval KPI…)
