# Seereon Delivery Board: Feature Guide

Sep 28, 2026 · @Santosh

This guide explains every feature of the board in plain words, one screen at a time, for the whole team: developers, the project manager, sales and new joiners. The screenshots come from the working prototype with dummy data. The SaaS build keeps the same screens and rules; the Technical Design has the build detail.

## 1. Roles and views

Everyone uses the same board, but each person sees only what their role needs. There are five roles: CEO (admin), project manager, sales, operations and employee.

&#91;image: Header with the week switcher, tabs, View as control and the five dashboard views\]

- **Header:** the company name, the week being viewed (use the arrows to move between weeks), and the tabs you are allowed to open.
- **View as (admin only):** the CEO can switch to any role to check exactly what that person sees. In the SaaS version this mode is read-only, so nothing can be changed by accident.
- **Dashboard views:** CEO, Project manager, Sales, Operations and Employee. A salesperson lands on Sales; an employee lands on Employee and cannot open the others.

| Role | Lands on | Can change | Cannot see |
| --- | --- | --- | --- |
| CEO (admin) | CEO dashboard | Everything, including settings, rates and payroll | Nothing hidden |
| Project manager | Project manager view | Own projects, tasks, allocation; approves team timesheets | Salaries, payroll, company finance (margins only if granted) |
| Sales | Sales view | Own leads and deals | Other people's pay, project costs |
| Operations | Operations view | Ops register, openings, leave entries | Salaries unless granted, margins |
| Employee | Employee view | Own tasks' status, own timesheet, comments | Other people's timesheets, money |

&#91;image: Employee view: tasks tagged to me, my week at a glance\]

The employee view shows only that person's world: tasks where they were mentioned or tagged, tasks they are covering for a colleague on leave, and their own delivery numbers for the week.

## 2. CEO dashboard: revenue first

The CEO lands on revenue, because that is the number that decides everything else. The Overview shows this month, this quarter and this financial year (April to March) side by side.

&#91;image: Revenue and earnings: month, quarter and year, with the 12-month chart and revenue ahead\]

- **Top four numbers:** revenue this month, this quarter, this financial year, and net earnings for the year. The arrow shows the change against the previous period.
- **Period table:** for each period, revenue billed, cash collected, total costs (salaries plus expenses), net earnings, net margin, and the change in revenue.
- **12-month chart:** billed and collected side by side, so a gap between invoicing and cash shows at a glance.
- **Where revenue came from:** split by stream (SAP consulting, products, services, subscriptions, AMS).
- **Revenue ahead:** milestones due but not yet invoiced, plus the weighted sales pipeline.

&#91;image: Delivery and milestone cash: health of all projects and money due in 30 days\]

Below revenue, **Delivery** shows how many milestones were hit on time, the schedule performance index (SPI: above 1.0 means ahead of plan), average lateness and overdue tasks. **Milestones and cash** lists milestones due in the next 30 days with their billing value, so the CEO sees which delivery dates carry money.

## 3. Projects: list, status, type

The Projects tab opens on a list of all projects. Click a row to open that project; click it again to close it.

&#91;image: Projects list with a filter chip for each status and the Create project button\]

- **Status chips:** All, Initiated, Active, On hold, NPA, Completed, Closed, each with a count. Click one to see only those projects.
- **Status column:** shows health (On track, At risk, Off track) and a dropdown to change the status right from the list. Moving to On hold, NPA (non-performing asset: a client not paying or not engaging) or Closed asks for a reason; every change is kept in the project's status history.
- **Columns:** project manager, commercial model (fixed price, time and material), type, progress (% and tasks done), planned end, forecast end (red when late), next milestone, contract value and projected margin.

| Status | Means |
| --- | --- |
| Initiated | Signed or agreed, work not started |
| Active | Work in progress |
| On hold | Paused; reason required |
| NPA | Client not paying or not responding; reason required |
| Completed | All work delivered, awaiting closure or final payment |
| Closed | Commercially closed; reason required |

**Project types:** Product, Service, SaaS, AMS (annual maintenance support).

&#91;image: Create project form: name, client, manager, dates, type, model, milestones and costing\]

**+ Create project** opens the form: name, client, project manager, start and planned end, type, commercial model, priority, milestones with billing amounts, documents, and the costing plan. The project code is generated automatically.

## 4. Project page: milestones, tasks and WBS

A project is broken into milestones, and milestones into tasks. That structure is the WBS (work breakdown structure).

&#91;image: Milestones M1 to M5 with progress, deadline, status, billing, Edit and Delete\]

- **Automatic numbers:** milestones are numbered M1, M2, M3 in order of creation; tasks inside M2 are 2.1, 2.2, 2.3. Numbers never change and are never reused, so "task 3.4" means the same thing in every conversation.
- **Deadline and end:** a milestone's deadline is the target end of its last task. The baseline shows the original date; red text shows the slip (for example +5d).
- **Status:** Achieved on time, Achieved late, On track, At risk.
- **Billing:** each milestone carries an amount and a billing state (Not due, Invoiced, Paid). The line below totals paid, invoiced-but-unpaid and achieved-but-not-invoiced.
- **Edit and Delete:** change a milestone's name, dates or billing amount. A milestone that has been invoiced cannot be deleted. Deleting one moves its tasks to "No milestone".
- **Auto-cleanup:** a milestone with no tasks for 7 days is removed automatically, unless it has been invoiced.
- **Add milestone:** type a name and optional billing amount at the bottom.

&#91;image: Work breakdown structure: tasks grouped by milestone, with owner, effort, dates and a + Task button per milestone\]

The **Work breakdown structure** lists every task under its milestone with its number, owner, effort (estimated vs actual hours), start and planned end, and float (spare days before it delays the project). **+ Task** on each milestone adds a task straight into it.

**WBS import:** instead of typing, paste rows from a spreadsheet or upload a CSV with the columns Milestone, Task, Owner, Estimated hours, Start, End, Complexity, Depends on, Milestone billing. **Download template** gives the exact format. **Preview** shows every row and flags errors (unknown owner, bad date, unknown dependency) before anything is saved; the import then saves all rows or none.

## 5. Schedule, critical path and change requests

&#91;image: Schedule: a Gantt chart of tasks by milestone, with today's line, the baseline and critical dates\]

The **Schedule** is a Gantt chart: one bar per task, grouped by milestone, placed by date. Critical tasks are red; milestones are marked on their dates; the dashed line is today. The **critical path** is the longest chain of dependent tasks to the project end: any delay on it delays the whole project, so those tasks get the most attention.

&#91;image: Critical path and breach risks, with actions to update progress, flag, reassign or comment\]

The project manager's **Critical path and breach risks** list shows each at-risk task, why it is at risk (waiting for another task, falling behind its estimate), and one-click actions: update progress, flag, reassign, or open the thread.

&#91;image: Change requests: raise, approve or reject, with effort and value\]

**Change requests** record anything the client adds after signing: title, effort in hours and value. Approving one adds its value to the contract and can add its tasks to the WBS. Nothing enters the plan without an approved change request, which protects the margin.

## 6. Costing, allocation and margins

Every project has a cost as well as a price. The board works out cost from the people on it and their hourly rate.

&#91;image: Costing and margin: planned, projected and actual; what moved the margin; milestone variance; resources allocated vs logged\]

**Resource allocation by milestone.** Each resource row names a person, the milestone (M1, M2, shown by code), the % of their time, and a from and to date. All four are required, so cost always lands on a milestone and a period.

**Cost per hour** = monthly salary (CTC) ÷ (working days in the month × minimum hours per day). Example: ₹60,000 ÷ (22 × 9) = ₹303 per hour.

**Three margins:**

| Margin | Revenue used | Cost used | Answers |
| --- | --- | --- | --- |
| Planned | Contract value | Allocation and estimates | What did we expect to make? |
| Projected | Contract value | Actual so far + what's left | Where are we heading? |
| Actual | Invoiced amount | Approved hours only | What have we really made? |

**Margin vs markup.** They are not the same number. Margin = profit ÷ price; markup = profit ÷ cost. If a job costs ₹1,00,000 and you charge ₹1,50,000, the markup is 50% but the margin is 33%. The board shows both side by side; decisions use margin.

**Effort ratio** = actual hours ÷ estimated hours. 1.0 means on estimate; 1.3 means the work took 30% longer than planned. It is shown per task, milestone and project, and anything above 1.2 is flagged.

**What moved the margin** explains the gap between planned and projected (for example: approved change requests, extra hours on a late milestone). **Milestone variance** shows each milestone's planned cost against its forecast. **Resources: allocated vs logged** compares each person's planned hours to the hours they actually logged.

&#91;image: CEO view of profit margins across all projects\]

The CEO sees the same numbers for every project in one table. Margins are visible only to the CEO and anyone given the margins permission.

## 7. Tasks: owners, dependencies, backup and threads

The Tasks tab lists every task with filters by person, project and status. Each task has:

- **One owner** who is accountable, and optionally a **backup** who covers it when the owner is on leave. On leave days the task appears in the backup's "Covering" list and they can log time on it.
- **Estimated hours, start and due date, complexity** (low, medium, high). Complexity feeds estimation accuracy in Insights.
- **Status:** To do, In progress, Blocked, In review, Done.
- **Depends on:** other tasks that must finish first. A task cannot be started while something it depends on is still open; the board names the blocking task and its owner, so the conversation goes to the right person.
- **Thread:** comments on the task. Typing @name mentions a person; they get a notification and see it under "Tagged you" on their dashboard.

Dependency chains are what the critical path (section 5) is built from, so setting dependencies correctly is what makes the forecast dates trustworthy.

## 8. Timesheet and daily update

Time is logged once a week, against tasks and activities. Task hours become the task's actual hours and its cost, so the timesheet feeds margins and payroll.

&#91;image: Timesheet: one empty row to fill, days of the week with the holiday greyed, day totals against 9 hours, Save draft and Submit for approval\]

- **One row at a time:** there is always one empty row. Pick a task or activity and enter hours; a new empty row appears as soon as you pick. Rows with no hours disappear.
- **Days:** Monday to Saturday for the week in the header. Holidays and weekly offs are greyed and marked.
- **Day total:** each day shows hours logged against the minimum (9 hours by default). Short days are highlighted.
- **Quick rows:** **+ Leave or holiday** (a full-day leave also marks you as on leave for planning; half-day is allowed), **+ Lunch, tea and stand-up**, and **Copy rows from last week**.
- **Save draft** keeps your work. **Submit for approval** sends the week to your manager and makes it read-only for you.
- **Weekly lock:** the banner shows the deadline ("submit by Sun, 4 Oct"). An unsubmitted week locks when it ends. Only your manager or the CEO can unlock it, for a set number of days, after you request it with a reason.

&#91;image: End-of-day update with a proof link, and the Friday demo check\]

**End-of-day update:** what you finished, a proof link (a commit, a document, a screenshot), and any blocker. No proof, no progress. **Friday demo** records whether you showed working software to the team that week.

## 9. Approvals and the manager's approval KPI

Every submitted week goes to the person's manager (their "reports to"). The manager has 2 working days to approve or reject it.

&#91;image: Timesheet approvals: 3 waiting, the approval KPI, hours by day with short days in red, Approve and Reject with reason, and the team's week-by-week status\]

- **KPI strip:** approvals on time in the last 30 days, approval lapses (a negative KPI: each approval made late or still waiting past the deadline counts against the manager), overdue right now, and waiting within the deadline.
- **Waiting list:** each week shows hours per day (short days in red), the total, and the due date. Overdue items turn red.
- **Approve** or **Reject**; rejecting needs a reason, and the week goes back to the person to fix.
- **My team's timesheets:** four weeks per person, coloured by status (Approved, Submitted, Locked, Draft). **Unlock** reopens a locked week for the person.
- **Delegation:** a manager going on leave can hand their approvals to someone else for a date range (see section 16).

The top person (the CEO) has no manager, so their weeks are approved automatically.

## 10. Payroll: pay for approved days

Payroll turns approved timesheets into the amount to pay each person for a month. It is visible to the CEO only.

&#91;image: Payroll for a month: working days, approved and unapproved days, leave without pay, deduction, sales variable and net pay per person\]

- Pick the month and click **Calculate payroll**.
- For each person: working days in the month, days in approved weeks, unapproved days, leave without pay, the deduction, sales variable earned, and net pay.
- **Deduction** = monthly base ÷ working days in the month × (unapproved days + leave-without-pay days).
- **Sales variable** is added only when that month's sales target was met in full.
- Anyone with unsubmitted or unapproved weeks is flagged before you pay, so you can chase the approval first.
- The SaaS version adds a CSV export for the bank or the accountant.

In the SaaS version, deducting unapproved days is a company setting (off by default for new customers), because withholding pay is a legal decision each company should make knowingly. The board computes the payable amount only; PF, ESI and TDS are out of scope for v1.

## 11. Sales: leads, pipeline and the activity trail

Every deal is traceable from first contact to cash: who created it, every stage it moved through and when, and every call, meeting and proposal along the way.

&#91;image: New lead form: opportunity, company, contact, product, source, owner, stage, value, recurring value, expected close and next step\]

**+ New lead** creates a lead by hand: opportunity name, company, contact person, phone, email, product, source (referral, BNI, website, cold call, event, partner), owner, stage, one-time value, monthly recurring value, expected close date, the next step and its date, and how the lead came in.

&#91;image: Pipeline: open value, weighted value, win rate, deals by stage and the funnel\]

**Pipeline** shows open value, weighted value (each deal's value × its stage's chance of closing), win rate, average days to close, and the funnel by stage: Lead, Qualified, Demo, Proposal, Negotiation, Won, Lost. Moving a deal to Lost asks for a reason; Won records the date and can create a project.

&#91;image: Sales activity log for the last 30 days: date, salesperson, deal, activity type and note\]

The **activity log** lists every stage change and activity in the last 30 days, by person and deal. A deal with no activity for 14 days is flagged as stale.

## 12. Sales cost, performance and pay

Sales is judged on what it costs against what it brings in, per person and per period.

&#91;image: Sales cost vs deals closed: switch by month, quarter or year; base and variable pay per salesperson; target, achieved and payout; trend by month\]

- **Month, Quarter, Year** switch the period.
- **Sales cost** = base salary + variable pay earned. **Deals closed** = value of deals won in the period. The ratio shows how many rupees of sales each rupee of sales cost produced.
- **Base and variable:** each salesperson's pay splits into a fixed base and a variable part (20% of CTC by default). Their monthly target defaults to their monthly CTC.
- **Variable is earned only at 100% of target.** At 95% of target, only the base is paid. Example: CTC ₹50,000, variable 20% → base ₹40,000, variable ₹10,000. Achieved 95% → pay ₹40,000. Achieved 100% → pay ₹50,000.
- **Trend by month:** sales cost against deals closed for each month.

&#91;image: Salesperson performance: activities, calls, meetings, demos, proposals, won, lost, win rate, average deal, cycle days and open pipeline\]

**Individual performance** gives one row per salesperson for the chosen period: activities logged, calls, meetings, demos, proposals, deals won and lost, win rate, average deal size, days from lead to won, and open pipeline. Below it, each person's last six months show target against achieved.

## 13. Finance: P&L and ledger

&#91;image: Monthly profit and loss for the last 6 months: billed, collected, payroll, other costs, net\]

**Monthly P&L** shows, for each of the last six months, what was billed, what was collected, payroll cost, other costs, and net (billed minus costs). It updates as invoices, payments and expenses are recorded.

&#91;image: Ledger: income and expense entries, recurring ones marked, with add and remove\]

The **Ledger** records income and expenses that do not come from project milestones: subscriptions, consulting retainers, rent, software. An entry can repeat monthly until an end date, so a ₹6,00,000 monthly retainer is entered once and appears in every month's revenue. Milestone invoices add their income automatically.

## 14. Project manager and operations dashboards

&#91;image: Project manager view: delivery control numbers and the task pipeline by status\]

The **Project manager** view starts with delivery control: active projects, critical tasks at risk, blocked or waiting tasks, tasks that should have started, tasks with no estimate, and scheduling conflicts. The task pipeline shows how many tasks sit in each status, so a pile-up in "In review" or "Blocked" is obvious.

&#91;image: Resource load for the next 10 working days: each person's booked hours against capacity\]

**Resource load** shows each person's booked hours against their capacity for the next 10 working days. Over 100% means someone is double-booked; well under means spare capacity to pull work forward.

&#91;image: Operations: recurring duties, due and overdue items with Mark done\]

The **Operations** view runs the company's non-project work: recurring duties (monthly, quarterly, yearly) such as receivables follow-up, payroll processing, statutory filings and renewals, each with an owner and due date. **Mark done** rolls a recurring item to its next date. Its other tabs cover people and timesheet status, payroll, and invoicing and collections, each with a one-line description of what it is for.

## 15. Insights, weekly scorecard and client view

&#91;image: Delivery predictions: projects and milestones with forecast dates and chance of finishing on time; tasks most likely to slip\]

**Insights** looks ahead instead of back. Delivery predictions give each project and milestone a forecast date (P50 = even odds, P80 = 80% sure) and a chance of finishing on time, and list the tasks most likely to slip with their owners.

&#91;image: Estimation accuracy by complexity and by person, with the suggested buffer\]

**Estimation accuracy** compares estimates to actual hours, by task complexity and by person, and suggests how much buffer to add to future estimates. It is how the team gets better at planning.

&#91;image: Weekly scorecard: each person's delivery score for the week\]

The **Weekly scorecard** gives each person a score for the week from on-time delivery, effort accuracy, daily updates and the Friday demo. Managers also carry their approval KPI (section 9).

&#91;image: Client view: milestone progress, what was completed, what is coming, and decisions needed from the client\]

The **Client view** is a clean, money-free page per project to share with the client: milestone progress, what was completed in the last two weeks, what is coming in the next two, and the decisions or inputs needed from them.

## 16. Team and settings

&#91;image: Team: each person's role, function, joining date, reports-to, access level, hours per day and monthly CTC\]

**Team** holds everyone who uses the board: name, role, function, joining date, who they report to (this decides who approves their timesheet), access level (which decides their dashboard view), working hours per day and monthly CTC (visible to the CEO only; it drives cost per hour and payroll).

&#91;image: Working hours and calendar: minimum hours, whether breaks count, weekly off days, which Saturdays are off, and the approval deadline\]

**Working hours and calendar** sets the company rules everything else calculates from: minimum hours per working day (9), whether lunch and tea breaks count toward it, the weekly off (Sunday), which Saturdays are off (2nd and 4th), and the manager's approval deadline in working days (2). The holiday calendar below it lists public holidays for the year.

&#91;image: Leave: record leave for a person and date range, and leave taken this financial year by type\]

**Leave** records leave for a person and a date range. Leave also comes in from the timesheet's leave row, so either route keeps both in step. The table shows leave taken this financial year by type (casual, sick, earned, compensatory, leave without pay).

&#91;image: Delegations: hand approvals to another person for a date range\]

**Delegations** let a manager hand their approvals (and optionally their task follow-ups) to another person for a date range, typically while on leave. Approvals made by the delegate count toward the delegate's approval KPI.

The SaaS version groups every company setting in one place, with the default and allowed range shown next to each; the Technical Design (section 15) lists them all.

## 17. Rules and KPI definitions

The Rules tab is the board's rulebook: the non-negotiable working rules, how the weekly score is built, how the schedule forecast works, and the consequences of breaking a rule. Every number on the board is defined here, so nobody argues about what a metric means.

&#91;image: KPI definitions: on-time delivery, effort ratio, markup and margin, sales cycle, cost per hour, working days and every other measure the board uses\]

The measures people ask about most:

| Measure | Plain meaning |
| --- | --- |
| On-time delivery | Share of tasks finished on or before their due date |
| Effort ratio | Actual hours ÷ estimated hours; above 1.0 means it took longer than planned |
| SPI | Schedule performance: work done ÷ work planned by today; below 1.0 means behind |
| Margin | Profit ÷ revenue |
| Markup | Profit ÷ cost (a 50% markup is a 33% margin) |
| Cost per hour | Monthly CTC ÷ (working days × minimum hours) |
| Win rate | Deals won ÷ (won + lost) |
| Approval KPI | Approvals made on time; late or missed approvals count against the manager |
| P50 / P80 date | The date a task or milestone has an even or 80% chance of finishing by |

When the board and a spreadsheet disagree, the definitions here decide which is right.
