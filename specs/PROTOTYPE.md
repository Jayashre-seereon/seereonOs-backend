# Seereon Delivery Board — Prototype Reference (for the React rebuild)

Source: single-file HTML prototype `index.html` (~330 KB, 2,434 lines, one IIFE `<script>` at lines 565–2431). Title: **"Seereon Delivery Board"**. Brand header: **"Seereon** *Delivery Board*".

This document is a reverse-engineered spec of everything the prototype does: screens, actions, data model, formulas, roles, validations and copy. Line numbers (`L1234`) refer to the prototype file so an engineer can jump to the original.

> Conventions used below
> - `TODAY` = local date `YYYY-MM-DD` at page load. `TI` = working-day index of `nextWork(TODAY)`.
> - "wd" = working day (per company calendar). All date strings are ISO `YYYY-MM-DD`; comparisons are string comparisons.
> - `₹` formatting: `inr(n) = '₹' + Math.round(n).toLocaleString('en-IN')` (lakh grouping).
> - Dates display with `toLocaleDateString('en-IN', {day:'numeric', month:'short'})` → "5 Oct"; `—` for empty.
> - RAG colours: `g` green, `a` amber, `r` red, `na` grey. `rag(v)`: `v>=90 → g`, `v>=75 → a`, else `r`, null → `na`.

---

## 0. Table of contents

1. Architecture and runtime
2. Global layout, header, tabs, theming
3. Data model (collections, entities, fields)
4. Seed / demo data
5. Calendar engine (working days, holidays, leave)
6. Core model build (`buildModel`) — stats, forecast, risk, WBS, project KPIs
7. Critical path (`cpm`)
8. Milestones
9. Weekly scorecard / metrics
10. Screens — Dashboard (CEO, PM, Sales, Ops, Employee)
11. Screens — Projects & WBS
12. Screens — Tasks
13. Screens — Timesheet & log
14. Screens — Weekly scorecard
15. Screens — Insights
16. Screens — Client view
17. Screens — Team & settings
18. Screens — Rules
19. Costing, margin, markup (formulas)
20. Finance dashboard (formulas)
21. Sales CRM and compensation (formulas)
22. Operations: recurring duties, HR, payroll (formulas)
23. Timesheet workflow, approvals, SLA, lock
24. Roles and "View as"
25. Validations and business rules (consolidated)
26. Toasts, confirms, prompts, error copy (consolidated)
27. Constants and enumerations (verbatim)
28. Dead code / quirks / known bugs to fix in the rebuild
29. Rebuild notes (React component map)

---

## 1. Architecture and runtime

- Vanilla JS, string-template rendering (`innerHTML`), event delegation on `document` and section roots. **Every data change calls `renderAll()`**, which rebuilds the whole model and re-renders every section (`renderAll0`, L1442):
  `buildModel → renderWeek → renderSelects → renderBoard → renderTasks → renderLog → renderTimesheet → renderPreview → renderDash → renderProjects → renderClient → renderSettings → renderTsStatus → (renderInsights if visible) → renderPfCost → syncMargins`, then `restoreInputs` (keeps typed values + focus for any element with `data-fk`), `applyRole()`, and `sweepMilestones()`.
- Persistence: the claude.ai artifact runtime. `window.claude.use('db')` returns a Firestore-like API: `db.collection(path).onSnapshot(cb)`, `.get()`, `db.doc(path).set/update/delete/get`. Also `use('user')` (`canEdit()`, `id()`), `use('assets')` (`upload(file)` → `{id,sizeBytes,contentType}`; files served at `/_blob/{id}`), `use('downloads')` (`save({filename,data})`).
- If `db` is unavailable: shows card "Live data isn't available in this view. Open the board from its claude.ai link to log and review." and all writes toast "Live data isn't available in this view."
- `isAdmin = await user.canEdit()` — **editor = CEO/admin**. Finance collections are only subscribed when admin.
- Writes are serialised per key with `queue(key, fn)` (promise chains): `t:{pid}` tasks, `w:{pid}` week docs, `a:{pid}` activities, `lv:{pid}` leave, `th:{taskId}` threads, `ph:{projectId}` phases.
- Optimistic updates: `saveTasks/saveWeek/saveActs/setTs/addThread` mutate local state, `renderAll()`, then persist.
- localStorage keys (per-device conveniences): `sab_me` (who I am / logging for), `sab_view` (dashboard view), `sab_proj` (expanded project), `sab_ceotab`, `sab_pf` (project status filter chip), `sab_cl` (client-view project), `sab_role` (admin "View as").
- IDs: `'t'+Date.now().toString(36)+rand` for tasks; `ph…` phases; `d…` deals; `o…` ops; `r…` openings; `l…` ledger; `cr…` CRs; `dg…` delegations; `bl…` baselines; `c…` comments; `a…` activities; project id = slug(name)+'-'+last 4 of base36 timestamp; person id = slug(name).

---

## 2. Global layout, header, tabs, theming

### Header (`header.top`)
- Brand: **Seereon** *Delivery Board*.
- Role bar (top-right):
  - Admin: label "View as" + select: `CEO (you)` (value ''), `Project manager`, `Sales`, `Operations`, `Employee`. Persisted in `sab_role`.
  - Non-admin: pill "`{Role label}: {My name}`".
- Week navigator: `‹` (Previous week) / `›` (Next week). Label: "`5 Oct – 9 Oct 2026`" (Mon–Fri) with sub-label **This week / Past week / Upcoming week**. Changing week re-subscribes to `weeks/{week}/people` and `weeks/{week-7}/people`, and resets the EOD form date.

### Tabs (sticky nav, in order)
| data-tab | Label |
|---|---|
| dash | Dashboard |
| projects | Projects & WBS |
| tasks | Tasks |
| log | Timesheet & log |
| board | Weekly scorecard |
| insights | Insights |
| client | Client view |
| settings | Team & settings |
| rules | Rules |

Visibility of tabs is role-driven (section 24). Initial tab = Dashboard.

### Theme (CSS tokens; SAP Fiori-like)
Light: `--bg #F5F6F7, --surface #FFF, --ink #1D2D3E, --muted #556B82, --line #D9DEE3, --brand #1D2D3E, --primary/--gold #0A6ED1, --g #107E3E / bg #EBF5EE, --b #0A6ED1 / #E8F2FB, --a #C35500 / #FEF3E6, --r #BB0000 / #FFEBEB, --na #6A7D90 / #EFF1F3`.
Dark (prefers-color-scheme or `data-theme=dark`): `--bg #12171C, --surface #1B232B, --ink #EAECEE, --muted #9AA8B5, --line #2E3A46, --brand #0E141A, --primary #1B90FF, --gold #4DB1FF, --g #5DC122, --a #FFAB5C, --r #FF8888 …`.
Font: Inter 400–800. Max width 1180px. Components: `.card`, `.kpis` (4-col grid, 2-col < 560px), `.seg` segmented control, `.seg.sub` underline tabs, `.chip`, `.stat` pills, `.bar` progress, `.hbar` horizontal bars, `.vbars` vertical paired bars, `.trend` bars, `.spark` sparkline, `.gantt`, `.tsbar` timesheet status banner, `#toast` (3.5s), `#lockout` overlay.

Chip classes: `chip done` (green), `chip todo/doing` (grey), `chip blocked`/`risk high`/`risk breach`/`chip crit` (red), `risk med` (amber), `risk low` (green), `chip act` (blue), `chip wait` (amber), `chip cov` (blue).

---

## 3. Data model

All persisted in the artifact DB. Paths below are exactly as used.

### 3.1 `people/{id}` (person)
| field | type | notes |
|---|---|---|
| name | string | first name used for @mentions |
| role | string | job title free text |
| hoursPerDay | number | "Productive hours/day", default 6 (1–12). Used for planning/forecast capacity |
| order | number | sort order (people sorted by `order`, default 99) |
| func | `'delivery'\|'sales'\|'ops'\|'mgmt'` | "Function"; default delivery |
| joinedOn | date | |
| exitedOn | date | set by "Mark exited" |
| active | bool | `false` = exited; excluded from `people`, kept in `allPeople` |
| reportsTo | personId | timesheet approver; '' = default |
| access | `''\|'ceo'\|'pm'\|'sales'\|'ops'\|'emp'` | override for role; '' = Auto |
| uid | string | linked claude.ai user id ("This is me: link to my account") |

### 3.2 `projects/{id}`
| field | notes |
|---|---|
| name, client | client '' → shown "Internal" |
| owner | personId (PM) |
| start, plannedEnd | dates |
| priority | 1 EduReon, 2 HRMS delivery, 3 Client project (default), 4 Everything else |
| type | `product\|service\|saas\|ams` → Product, Service, SaaS, AMS |
| billing | `fixed\|tm` → "Fixed cost" / "Time & resources" (T&M) |
| status | stored raw: `initiated\|active\|hold\|npa\|completed\|closed` (legacy `done` → closed). Normalised in memory: `p.stat` = raw key; `p.status` = `'done'` if closed/completed else raw |
| statusOn, statusHistory[] | `{from,to,on,by,note}` |
| phases[] | milestones (below) |
| documents[] | `{id,name,size,type,on}` |
| baselines[] | `{id,name,on,end,bac,ms:{phaseId:due},tasks:{taskId:[start,estDue,estHours]}}` |
| createdOn | |

Project statuses (`PSTAT`): `initiated` Initiated (blue), `active` Active (green), `hold` On hold (amber), `npa` NPA (payment stuck) (red), `completed` Completed (green), `closed` Closed (grey).

#### Phase / milestone (`project.phases[]`)
`{id, no, name, amount (₹ billing), billing:'pending'|'invoiced'|'paid', invoicedOn, paidOn, createdOn, emptySince}`. Numbers `no` are fixed once assigned ("M1, M2…").

### 3.3 `tasks/{personId}` — one doc per assignee
`{personId, tasks:[Task], updatedAt}`. A task's owner is the doc it lives in (`t.pid` added in memory). Reassign = remove from one doc, push to another.

Task:
| field | notes |
|---|---|
| id, no | `no` = task number within milestone → WBS code `{phaseNo}.{no}` |
| title | |
| projectId, phaseId | '' allowed |
| deps[] | taskIds (finish-to-start) |
| cx | complexity 1 Low, 2 Medium, 3 High, 4 Very high |
| estHours | estimate |
| start | planned start |
| estDue | target end date |
| revisedDue, flaggedOn | set by "Flag slip". `effDue(t) = revisedDue || estDue` |
| status | see 27. Legacy `todo→new`, `doing→dev` |
| statusOn, startedOn, blockedOn | |
| progress | 0–100 (manual max 95; done = 100) |
| doneOn, proof, actualHours | set on completion |
| log | `{ 'YYYY-MM-DD': hours }` from timesheet |
| note, noteOn, noteBy | |
| backup | personId |
| createdOn, assignedBy, importedOn, reassignedFrom, reassignedOn | |

### 3.4 `acts/{personId}` — timesheet activity rows
`{personId, items:[{id,type,projectId,note,log:{date:hours},createdOn}], updatedAt}`. `type` ∈ ACT_TYPES keys (section 27).

### 3.5 `weeks/{weekMonday}/people/{personId}` — week doc
`{personId, week, eod:{date:{done,proof,blocker,savedAt}}, demo:{shown,note}, ts:{…timesheet state…}, updatedAt}`
`ts`: `status ('submitted'|'approved'|'rejected'|undefined=draft)`, `submittedOn, submittedAt, approver, days:{date:hours}, total, decidedBy ('auto' allowed), decidedOn, late(bool), reason, unlockReq, unlockReqOn, unlockUntil, unlockedBy, unlockedOn`.

### 3.6 `threads/{taskId}`
`{taskId, items:[Item], updatedAt}`; Item `{id, at(ISO), by, type:'comment'|'bug'|'question'|'decision'|'status'|'sys', text, parentId, links[], files[{id,name,size}], mentions[personId], fixed, fixedBy, fixedOn, from, to}`.

### 3.7 `settings/company`
`{approvalSla (default 2), minHours (9), weekendDays [0..5] (Sunday=0), satOff 'all'|'none'|'some', satOffWeeks [1..5], breaksCount (true), updatedOn}`. Legacy `sats` (working Saturdays) converted.

### 3.8 `settings/calendar`
`{holidays:[{date,name,optional?}]}`.

### 3.9 `leave/{personId}`
`{dates:[date], src:{date:'ts'}}` — `src[d]='ts'` means auto-added from a full-day leave timesheet row.

### 3.10 `delegations/{id}`
`{from, to, start, end, projectId('' = all), note, by, createdOn}`.

### 3.11 `crs/{id}` (change requests)
`{projectId, no, title, requestedBy, effortHours, daysImpact, amount, reason, status:'proposed'|'approved'|'rejected', raisedOn, decidedOn}`.

### 3.12 `deals/{id}` (sales CRM)
`{title, client, contact, phone, email, product, source, owner, stage, value (one-time ₹), mrr (₹/month), expectedClose, nextText, nextDate, createdOn, createdBy, stageChangedOn, stageHistory:[{from,to,on,by,note}], activities:[{date,type,note,by}], wonOn, lostOn, lostReason, projectId}`.

### 3.13 `ops/{id}` (recurring responsibilities)
`{title, area ('HR'|'Payroll'|'Finance'|'Compliance'|'Admin'|'IT'), owner, freq 'monthly'|'weekly'|'quarterly', dueDay, log:{periodKey: doneDate}, createdOn}`.

### 3.14 `openings/{id}`
`{role, candidates, status:'open'|'filled', openedOn, filledOn}`.

### 3.15 Finance (admin-only)
- `finance/cost/rates/{personId}`: `{monthlyCTC, variablePct, salesTarget, updatedOn}`.
- `finance/cost/projects/{projectId}` (saved costing): `{alloc:[{pid,msId ('*'=all),pct,from,to}], extras:[{cat,desc,amount}], maintenance, contingency (%), markup (%), price, mode:'markup'|'price', billing, start, end, updatedOn}`. Legacy alloc rows may have `md` (man-days) instead of `pct`.
- `finance/cost/meta/settings`: `{cash, overheads (monthly), loadPct (cost loading %), updatedOn}`.
- `finance/ledger/entries/{id}`: `{kind:'income'|'expense', category, amount, date, recurring (monthly), until, note, status:'received'|'invoiced'|'paid', receivedOn}`.
- `margins/{projectId}` (readable by non-admins; written by admin client): `{contract, eac, actCost, earned, profit, marginPct, plannedPct, todayPct, breach, early, owner, updatedOn}` — lets PMs see margins without salaries.

---

## 4. Seed / demo data

**The prototype ships with no seed data** — everything comes from the live DB. The only names hard-coded in JS are in the WBS import template CSV (L1277):

```
Milestone,Task,Owner,Estimated hours,Start,End,Complexity,Depends on,Milestone billing
Requirements,Stakeholder interviews,Subhankar,16,2026-10-05,2026-10-08,Medium,,150000
Requirements,Requirements sign-off,Santosh,4,2026-10-09,2026-10-09,Low,1.1,
Build,API development,Hritesh,40,2026-10-12,2026-10-23,High,1.2,300000
```

Other hard-coded example text: placeholder task "Fee collection API with receipts"; project milestone placeholder "Requirements sign-off | 150000 / Core modules | 300000 / UAT sign-off | 200000 / Go-live | 250000"; holiday "2026-10-02 Gandhi Jayanti", "Diwali"; lead "EduReon for 2 campuses"; ops "PF and ESI filing"; role "QA engineer"; ledger "SAP consulting, client X", "AWS for 12 months".

### 4.1 Suggested demo seed for the rebuild (NOT in the prototype — built from the real Seereon team/client context; mark as demo)

People (`func`, `hoursPerDay`, `reportsTo`, suggested monthly CTC ₹ — invent/adjust):
| id | name | role | func | reportsTo | CTC |
|---|---|---|---|---|---|
| santosh | Santosh Nayak | CEO & Founder | mgmt | — | — |
| subhankar | Subhankar Rout | Delivery Head / PM | delivery | santosh | 90,000 |
| hritesh | Hritesh Panda | Senior MERN developer | delivery | subhankar | 70,000 |
| bijaya | Bijaya Jena | FastAPI developer | delivery | subhankar | 40,000 |
| jagannath | Jagannath Nayak | FastAPI developer | delivery | subhankar | 40,000 |
| jayashree | Jayashree Dash | MERN developer | delivery | subhankar | 35,000 |
| pragyasmita | Pragyasmita Pallai | PHP/Laravel/React developer | delivery | subhankar | 45,000 |
| baishali | Baishali Rout | Sales & content | sales | santosh | 40,000 (variable 20%) |
| subham | Subham | Designer → sales | sales | santosh | 30,000 (variable 20%) |

Projects (priority per rules):
| name | client | PM | type | billing | priority | milestones (₹) |
|---|---|---|---|---|---|---|
| EduReon (meraCampus) v2 | Internal | Subhankar | product | fixed | 1 | Requirements sign-off 0 · Fee & admissions 0 · UAT 0 · Go-live 0 |
| SeerHR HRMS — mining group | (mining client) | Subhankar | product | fixed | 2 | Gap analysis sign-off 150000 · Core HR & payroll 300000 · UAT sign-off 200000 · Go-live 250000 |
| EduReon — Mother's Group of Schools | Mother's Group of Schools | Subhankar | product | fixed | 3 | Setup 100000 · Data migration 150000 · Go-live 200000 |
| Sales CRM | Digitalratha | Subhankar | service | fixed | 3 | Build 200000 · Go-live 100000 |
| DMS | (client) | Hritesh (or Subhankar) | service | tm | 3 | — |
| SAP AMS — RCU | Royal Commission for AlUla | Santosh | ams | tm | 3 | — |

Deals (stage, value, mrr, product, source):
| title | client | product | source | stage | value | mrr |
|---|---|---|---|---|---|---|
| EduReon for 2 campuses | Mother's Group of Schools | EduReon | BNI | won | 450000 | 15000 |
| SeerHR for mining group | (mining client) | SeerHR | Referral | negotiation | 900000 | 25000 |
| Custom sales CRM phase 2 | Digitalratha | Custom software | Existing client | proposal | 300000 | 0 |
| EduReon for SAMET | SAMET School of Management | EduReon | BNI | demo | 250000 | 8000 |
| Bakery ordering app | Dessert Garden | Custom software | BNI | qualified | 180000 | 0 |
| Lighting dealer portal | EMAAAR Lighting Solutions | Custom software | BNI | lead | 200000 | 0 |
| SAP CPI support | ZooPlus Germany | SAP consulting | Existing client | won | 600000 | 0 |
| Jewellery catalogue app | (Rahul Shah, jeweller) | Custom software | BNI | lost ("Budget moved to next year") | 150000 | 0 |

Ops duties: "Payroll processing" (Payroll, monthly, day 1), "PF and ESI filing" (Compliance, monthly, 15), "GST filing" (Compliance, monthly, 20), "TDS deposit" (Compliance, monthly, 7), "Weekly invoicing review" (Finance, weekly, 5), "Advance tax" (Finance, quarterly, 15).
Holidays (Odisha FY26-27 sample): 2026-10-02 Gandhi Jayanti, 2026-10-20 Durga Puja, 2026-11-08 Diwali, 2027-01-26 Republic Day, 2026-10-17 (optional) Kumar Purnima.
Finance settings: cash 1,500,000; overheads 150,000/month; loadPct 20.
Ledger: income "SAP consulting, RCU" 350,000 recurring monthly; expense "Office rent" 45,000 recurring; expense "Tools & software" 12,000 recurring.

---

## 5. Calendar engine (L575–623)

Company config → globals: `WKND` (weekly off days, excluding Saturday which has its own rule), `SATOFF`, `SATWK`, `MINH` (min hours/day, default 9), `BRK_COUNT` (breaks count toward minimum, default true).

```
isWork(d):
  g = weekday(d)
  if g == 6 (Sat) and 6 not in WKND:
     SATOFF=='all'  → false
     SATOFF=='none' → true
     'some'         → !SATWK.includes(ceil(dayOfMonth/7))   // 1st..5th Saturday
  return !WKND.includes(g)
```
Default: Sunday off, every Saturday off.

- `nextWork(d)` / `prevWork(d)`: step forward/back to a working day (max 14 steps).
- Working-day index: precomputed map from 2015-01-01 to 2046-01-01. `wdi(d)` = index of that working day (non-working days map to the next working day's index); `fromWd(i)` inverse; `addWorkdays(d,n) = fromWd(wdi(nextWork(d))+n)`; `wdDiff(a,b) = wdi(b)-wdi(a)`.
  - NOTE: holidays are **not** excluded from `wdi` (only weekly offs). Holidays/leave only reduce **capacity** (`dayCapD`) and **timesheet target** (`dayMinD`), and are excluded in `spanInfo`.
- `spanInfo(a,b)` → `{cal, wk (weekend days), hol (holidays on working days), wd (working days)}` inclusive.
- `spanText(a,b)`: "`5 Oct 2026 to 30 Nov 2026: 57 calendar days, 16 weekend days, 2 holidays, **39 working days**.`" or "The end date is before the start date."
- `HOL` = set of non-optional holiday dates. `LV[pid]` = set of leave dates.
- `capOf(pid) = person.hoursPerDay || 6`.
- `dayCapD(pid,d) = 0 if !isWork(d) || HOL || on leave else capOf(pid)` (planning capacity).
- `dayMinD(pid,d) = 0 if !isWork || HOL || leave else MINH` (timesheet target).
- `WDPM` (avg working days per month) = working days (excl. holidays) in current FY (1 Apr–31 Mar) ÷ 12; fallback 22.
- FY helpers: `fyStart()` = 1 April of current FY; `fyQuarter(date)` → `{st,en,name:'Q1 FY26-27'}` with Q1=Apr–Jun, Q2=Jul–Sep, Q3=Oct–Dec, Q4=Jan–Mar; `fyOf(date)` → `{st,en,name:'FY26-27'}`; `monthsBack(n)` = last n months `YYYY-MM` oldest first; `mLabel('2026-09')` = "Sep 26".

---

## 6. Core model build — `buildModel()` (L681–747)

Produces `M = {all, by, stats, fc, rk, load, teamRatio, wbs, PK, succ}`.

### 6.1 Effort ratio
- For each done task with `doneOn`, `estHours>0`, `actualHours>0`: ratio = `actualHours/estHours`.
- `teamRatio = median(all ratios)` if ≥3 samples, else 1.
- Person `ratio = median(own ratios)` if ≥3, else `teamRatio` (shown with `*` = "Team default effort ratio until the person has 3 completed tasks with actual hours").

### 6.2 Per-person stats (`M.stats[pid]`)
```
md      = my done tasks with doneOn
late    = md where doneOn > estDue
onTime  = round((md - late)/md*100) or null
slip    = avg over late of max(0, wdDiff(estDue, doneOn))       // working days
byCx[k] = on-time % for complexity k if ≥2 done tasks of that cx
overdue = open tasks with effDue < TODAY
thru    = done with doneOn > fromWd(TI-20)             // "last 4 weeks"
thruPrev= done with fromWd(TI-40) < doneOn <= fromWd(TI-20)
estDone, actDone = sums on done tasks
ratio, ratioN, doneN, openN, late (count)
predicted = count of open tasks with risk lvl 'high'
```

### 6.3 Queue forecast — `queueFinish(pid, open, ratio)` (L670)
Each person works their open tasks sequentially, sorted by `effDue` ascending:
```
day = TI; left = dayCap(pid, TI)
for t in queue:
  st = t.start ? wdi(nextWork(t.start)) : TI
  if st > day: day = st; left = dayCap(pid, day)
  h = max(0.5, (estHours||4) * ratio * (1 - min(90, progress)/100))
  rem = h
  consume h across days, advancing day when left==0 (left = dayCap(pid, day))
  out[t.id] = {qf: day (finish index), rem}
```

### 6.4 Dependency-adjusted forecast (`M.fc`)
Topological order over all tasks (cycles appended at end). For each task:
- done: `{s: wdi(startedOn||start||doneOn), f: wdi(doneOn)}`.
- else: `pm` = max predecessor finish (a done predecessor counts as `min(F.f, TI-1)`), `waitOn` = that predecessor.
  `remDays = max(1, ceil(q.rem / capOf(pid)))`; `s = max(TI, wdi(start))`; if status group is **act** (in progress) `s = TI`; if `pm+1 > s` → `s = pm+1`, depPush.
  `f = max(q.qf, s + remDays - 1)`.
- Output `fc[id] = {start, finish, waitOn (if pushed), rem}`.

### 6.5 Risk classification (`M.rk`) — open tasks only, first match wins
| lvl | label | condition | why text |
|---|---|---|---|
| breach | Breached | `effDue < TODAY` | "Overdue since {due}" |
| high | High risk | status in wait group (feedback/hold/blocked) | "{Status} since {statusOn}" |
| high | High risk | `fc.finish > effDue` | "Waiting on "{title}" ({owner}); forecast end X, target Y" or "Forecast end X, target Y" |
| med | Medium risk | `wdDiff(fc.finish, due) < 1` | "Forecast end X: no buffer" |
| med | Medium risk | person's `byCx[cx] < 70` | "{n}% on-time record on {High} tasks" |
| med | Medium risk | `ratioN>=3 && ratio>1.3` | "Usually needs 1.4× the estimate" |
| low | On track | else | "Forecast end X" |

### 6.6 Utilisation (`M.load[pid]`)
`hrs` = Σ `fc.rem` of my open tasks with `effDue <= fromWd(TI+10)`; `cap` = Σ dayCap over next 10 working days (min 1); `pct = round(hrs/cap*100)`. Colour: >100 r, >85 a, else g.

### 6.7 WBS numbering (`M.wbs`)
Per project: groups = each phase (code = `ph.no || index+1`) + "Tasks without a milestone" (code = max phase no + 1). In a group, tasks sorted by `no`, then start, then createdOn; tasks without `no` get the next unused integer. WBS code = `{groupCode}.{n}` e.g. `2.3`. Milestone label = `M{code}`.
- `nextTaskNo(project, phase)` = max existing no + 1. `nextPhaseNo(pr)` = max no + 1. `numberPhases()` backfills missing `no`.

### 6.8 Earned value
```
evOf(t) = done ? estHours : estHours * min(100, progress)/100
pvOf(t) = planned hours to date, linear over [wdi(start), wdi(estDue)]:
          TI > e → h ; TI < s → 0 ; else h*(TI-s+1)/(e-s+1)
```

### 6.9 Project KPIs — `projKPI` (L766) → `M.PK[projectId]`
```
bac = Σ estHours ; ev = Σ evOf ; pv = Σ pvOf
ac  = Σ actualHours (done) ; evd = Σ estHours (done)
pctDone = ev/bac*100
spi = pv>0 ? ev/pv : null            // Schedule performance
cpi = ac>0 ? evd/ac : null           // Effort performance
fEnd = max fc.finish over project tasks
sv   = wdDiff(plannedEnd, fEnd)      // + = late (working days)
breaches  = done late + open with effDue < TODAY
predicted = open with risk 'high'
onTime    = % of done with doneOn <= estDue
health k:
  'na' if no tasks
  'r'  if sv>0 or spi<0.8
  'a'  if spi<0.95 or predicted or breaches
  'g'  otherwise; then 'g'→'a' if any milestone state risk/missed
  'na' if project closed/completed
msN, msDoneN, msOnTime (% achieved milestones that were 'hit'), msRisk
bill = {achieved, invoiced, paid, upcoming, total} (see 8)
nextMs = earliest-due not-done milestone
cpm = critical path result; crOpen; conflicts = # tasks with dep conflicts; blocked count
```
SPI/CPI colour: ≥0.95 g, ≥0.8 a, else r. Health label in list: r "Off track", a "At risk", g "On track", na "No tasks"; non-active status shows status label instead.

### 6.10 Successors map `M.succ[taskId]` = tasks that depend on it.

---

## 7. Critical path — `cpm(tasks, groups)` (L653)

Uses **planned dates exactly as entered** (not forecast).
```
ES[t] = min(wdi(nextWork(start||estDue)), wdi(prevWork(estDue||start)))
EF[t] = max(...same two...) ; dur = EF-ES+1
conflict: for each dep d of t: if ES[t] <= EF[d] → conflicts.push({t,d})
per milestone group g:
  end = max EF in g ; msEnd[g.code] = end
  reverse-topological over tasks in g:
    LF[t] = min(end, min over successors-in-g of LS[s]-1)
    LS[t] = LF - dur + 1
    float[t] = LF - EF[t]            // working days
    crit if float <= 0
  msCrit[g.code] = critical tasks sorted by ES, EF
finish = max EF (project-level) → date
path  = walk back from the task with EF==finish (ties: most deps) choosing
        predecessor with latest EF each step (max 500)  → "Longest dependency chain"
cyc   = tasks in a dependency cycle
```
Task shows **Critical** chip if in `crit` and not done. Gantt planned bar gets red border for critical tasks.

---

## 8. Milestones — `msCalc(g, fc)` (L748)

```
g.due     = max estDue of its tasks          // "Milestone deadline is always the target end of its last task"
g.bac, g.ev, g.pct = ev/bac*100
g.allDone = has tasks and all done
g.doneOn  = max doneOn when allDone
g.fEnd    = max( done ? doneOn : fc.finish )
g.state   = empty (no tasks) | hit (allDone & doneOn<=due) | late (allDone & doneOn>due)
            | missed (due<TODAY) | risk (fEnd>due) | ontrack
```
Labels (`MS`): hit "Achieved on time" (green), late "Achieved late" (red), missed "Deadline missed" (red), risk "At risk" (amber), ontrack "On track", empty "No tasks yet".

Billing per milestone with `amount>0` (`bill` in projKPI):
- `billing==='paid'` → paid; `'invoiced'` → invoiced; else if allDone → **achieved (not yet invoiced)**; else if `fEnd <= fromWd(TI+22)` → upcoming (next ~30 days).

Billing select options: `pending` shown as "To invoice" (if allDone) or "Not due"; "Invoiced" (sets `invoicedOn` = today if empty); "Paid" (sets `invoicedOn` if empty and `paidOn` = today).

Auto-sweep (`sweepMilestones`, admin only, every 5s after data ready ≥2.5s): a milestone with 0 tasks and not invoiced/paid gets `emptySince = TODAY`; removed once `wdDiff(emptySince,TODAY) >= 7` or `emptySince+7 calendar days <= TODAY` (`EMPTY_DAYS = 7`). Gaining tasks clears `emptySince`. UI note: "No tasks: auto-removed on {date}".

Deleting a milestone: blocked if invoiced/paid ("This milestone has been invoiced, so it can't be deleted. Edit it instead."). Confirm: "Delete milestone "{name}"? Its N tasks will stay in the project under "Tasks without a milestone"." Tasks get `phaseId=''`.

---

## 9. Weekly scorecard metrics

### 9.1 Delivery roles — `metricsDelivery(pid, wk)` (L791)
If `TODAY < wk` → all null. Window: Mon `wk` to `end = min(TODAY, Sat)`.
```
elapsed = # days in window with dayMinD>0 ; expH = Σ dayMinD
Updates     upd = min(100, round(#EOD entries in window / elapsed *100))
Timesheet   ts  = min(100, round(hoursIn(pid, wk, end, forTarget) / expH *100))
Delivery    del = tasks with estDue in [wk, wk+6]:
                  ok  = done && doneOn<=estDue ; fail = late (done late, or open & estDue<TODAY)
                  del = round(ok/(ok+fail)*100)
Early warning er: slips = late or flaggedOn ; early = flaggedOn && flaggedOn<=estDue ; er = early/slips*100
Demo        demo = 100 if week doc demo.shown ; 0 if TODAY>=Friday ; else null
score = round(mean of non-null [del, upd, ts, demo, er])
cells: Delivery, Updates, Timesheet, Demo, Early warning
```
`hoursIn(pid,a,b,forTarget)`: sum of task logs + activity logs in range; with `forTarget`: skip break rows if `!BRK_COUNT`, skip leave-row hours on days already marked as leave (LV).

### 9.2 Sales roles (L1898)
```
Activities = min(100, round(#deal activities by me in window / 15 *100))   // SALES_ACT_TARGET = 15
Follow-ups = my open deals ? max(0, 100 - 25 * overdueNextSteps) : null      // nextDate < min(end,TODAY)
New leads  = min(100, newDealsOwnedCreatedInWindow * 50)                     // target 2/week
Updates, Timesheet  (from delivery calc)
```
### 9.3 Operations roles
`Ops on time` = duties whose period due date falls in [wk,end] and were logged done on/before due ÷ due; plus Updates, Timesheet.

### 9.4 Managers — Approvals cell (L1892)
If person is a manager (`isMgr` = someone's approver is them): add cell **Approvals** = `apprKpi(pid, wk, wk+6).pct`, and score = mean of all non-null cells.
`mgmt` func uses the delivery formula.

### 9.5 Colours / thresholds
90+ green, 75–89 amber, <75 red. "Red two weeks running: 1:1 due" flag when this week and previous week both red. "N tasks forecast to breach" flag.

---

## 10. Screen — Dashboard (`#dash`)

Segmented control (`.seg`): **CEO · Project manager · Sales · Operations · Employee** (`data-view` ceo/pm/sales/ops/emp; persisted `sab_view`). Visible buttons depend on role (section 24). Clicking resets any pending inline task action.

### 10.1 CEO view — `ceoShell()`
Sub-tabs (`.seg.sub`, persisted `sab_ceotab`): **Overview · Projects · Sales · Finance · Operations**. Sales = `salesDash()`, Finance = `financeDash()`, Operations = `opsDash()` (same as the standalone views).

#### Overview (`ceoDash`), cards in order
1. **Revenue and earnings** (admin only, `ceoRevenue`):
   - KPIs: Revenue this month (▲/▼ % vs last month), Revenue this quarter (vs last quarter), Revenue this financial year (vs same period last year), Net earnings this financial year (red if negative, shown "−₹…").
   - Table: Period | Revenue billed | Collected | Costs | Net earnings | Net margin | Revenue change. Rows: "This month", "This quarter (Q2 FY26-27)", "This financial year".
   - Chart "Monthly revenue, last 12 months" — paired vertical bars Billed (primary) / Collected (green), label "{k}k" above; tooltip "Sep 26: billed ₹…, collected ₹…, net ₹…".
   - "Where revenue came from, this financial year" hbars by stream (`src==='ms'` → "Project milestones", else ledger category) with % of FY revenue.
   - "Revenue ahead" hbars: Milestones billable in 30 days / In 60 days / In 90 days / Weighted sales pipeline.
   - Footnote: "Revenue = invoices raised (milestones marked invoiced, plus consulting and other income in the ledger). Costs = payroll + overheads + expenses. Net earnings = revenue − costs."
   - Formulas: see 20.2.
2. **Delivery** KPIs:
   - On-time delivery, all completed tasks = done on/before estDue ÷ done (RAG 90/75)
   - Average schedule performance (SPI) = mean SPI of active projects with tasks
   - Average effort performance (CPI) = mean CPI
   - Utilisation, next 10 working days = Σ load.hrs / Σ load.cap (>100 r, >85 a)
   - Active projects in red = `atRisk / active` (health k==='r')
   - Open tasks already breached
   - Tasks forecast to breach (risk high)
   - Tasks done in last 4 weeks (previous 4: N) — green if ≥ previous
   - Footer "Team weekly score: **N**" = mean of people's weekly scores.
3. **Milestones and cash**: Milestones achieved on time (N achieved); Achieved, not yet invoiced (red if >0); Invoiced, awaiting payment; Billable in the next 30 days (forecast). Then "Due in the next 30 days" milestone table (due <= `fromWd(TI+22)`): Milestone (Project M# / name, % done) | Deadline | Forecast (red if > deadline) | Status chip | Billing.
4. **Profit margins** (admin) — `orgMarginCard` (section 19.6).
5. **Portfolio** — `portfolioTable`: Project (P#, PM) | Progress bar + "x%, d/n tasks" | SPI | CPI | Planned end | Forecast end | Variance ("+Nd late"/"Nd early"/"on plan") | Risks ("N breached", "N forecast"). Sorted by priority.
6. **Where the time goes, last 4 weeks** — `timeBars` categories: Project tasks, Operations work, Sales work, Other work, Meetings, Training, Travel, Breaks, Leave (hours and %), "Nh logged in total."
7. **Throughput, last 8 weeks** — `trendHtml`: bars per week = tasks done, bar colour by on-time % that week (<75 red, <90 amber, else brand); legend "90%+ on time / 75–89% / below 75%".
8. **People** — `peopleTable`: Person | Week score | On-time (+N done) | Effort ratio "×1.20" (`*` = team default; red if >1.3 with ≥3 samples) | Done 4 wks | Utilisation | Avg slip "1.5d" | Breaches (late+overdue) | Forecast (predicted).
9. **Top 5 risks by priority** — open breach/high tasks sorted by project priority then due; read-only task items. Empty: "No breaches predicted."

#### CEO → Projects (`ceoProjects`)
Admin: Profit margins card; **Mix** card (hbars "By project type" contract value + "x% margin"; "By commercial model" Fixed cost / Time & resources); **Closed projects** margin table. All: **Delivery health** (portfolio table), **People** table. Clicking a margin row (`data-open`) opens that project in Projects & WBS.

### 10.2 Project manager view — `pmDash()`
- Picker "Project manager" (people who own ≥1 project; "All project managers"). Defaults to me if I'm a PM.
- **Timesheet approvals** card (section 23).
- **Delivery control** KPIs: Active projects; Critical-path tasks at risk (critical & risk ≠ low); Blocked, on hold or waiting; Tasks past planned start, not started (status new/selected & start < TODAY); Open bugs (open bug comments); In unit or functional testing; In UAT with the client; Waiting for feedback. Footnote: "N tasks planned to start before a predecessor ends. N tasks without an effort estimate."
- **Task pipeline** hbars: count per status (excluding Completed); wait group red, not-started amber.
- **Projects** portfolio table.
- **Project margins** (`pmMarginCard`): non-admin reads `margins/{id}`; if none "Margins appear here once Santosh has saved each project's costing." KPIs Contract value / Projected profit / Projected margin / Actual margin to date + table; footer "Every hour your team logs moves these numbers. Salaries are never shown here."
- **Upcoming milestones** (next 8 open).
- **Resource load, next 10 working days**: per person "Xh of Yh (Z%)" + bar.
- **Bottlenecks** (`bottleneckCard`): open tasks with open successors; slack = `wdDiff(forecastEnd, earliest successor start) - 1`; sorted by slack asc then #successors; top 10. Columns: Task | Owner (+backup) | Forecast end | Blocks | First dependent starts | Slack (<0 red "−Nd late", <2 amber).
- **Critical path and breach risks** — riskList (breach/high). Empty: "Nothing on the critical path is at risk."
- **Blocked, on hold or waiting** and **Should have started** lists (task items with actions).

### 10.3 Sales view — `salesDash()` (section 21)

### 10.4 Operations view — `opsDash()` (section 22)

### 10.5 Employee view — `empDash()`
- Picker "Employee" (enabled only for roles ceo/pm/ops; others locked to self). Changing sets `logPid`.
- Top: Timesheet approvals card (if I'm an approver), **Covering for others** (delegations to me active today + tasks whose backup is me and owner on leave today; "Coming up: X from … to …" for delegations starting within 14 days), **Tagged you** (mentions in last 21 days, max 8, "Open task" button → Tasks tab filtered to that person with thread open).
- If person func=sales → `salesPersonCard` (score, My pipeline, Won this quarter, Overdue follow-ups, score cells, "My deals" list sorted by next date). func=ops → `opsPersonCard` (score, On time last 90 days, Overdue now, Responsibilities owned; Due and overdue list). Then "My time this week".
- Delivery person card: KPIs This week's score, On-time delivery, Effort ratio (actual ÷ estimate), Utilisation next 10 wd, Tasks done in 4 weeks (previous: N), Average slip when late, Breaches to date, Forecast to breach; then score cells.
- **Open bugs on my tasks**; **Now** (open tasks with forecast start ≤ today or in active status; empty "Nothing scheduled for today."); **Others are waiting on you** ("{name} can start once your predecessor task is done."); **Coming up**; **My time this week**; **My throughput, last 8 weeks**.

---

## 11. Screen — Projects & WBS (`#projects`)

### 11.1 Page head
"Projects" + count "N open, M completed or closed. Click a project to expand it." Button **+ Create project** toggles the create form.

### 11.2 Create project form (`#projForm`)
Fields: Project name* · Client · Project manager (select) · Start* (default today) · Planned end* · span preview ("Pick a start and end date to see working days, weekends and holidays." → spanText) · Project type (Product/Service/SaaS/AMS (application maintenance)) · Commercial model (Fixed cost / Time & resources) · Priority (1 — EduReon, 2 — HRMS delivery, 3 — Client project [default], 4 — Everything else) · Milestones textarea "one per line in delivery order. Optional billing amount after a | e.g. "UAT sign-off | 200000"" · Documents (PDF, images, text, CSV; up to 20 MB each; note "Word and Excel files: save as PDF first." or "Uploading needs Editor access to this board.") · **Costing** (admin only, pill "Visible to editors only") = cost widget (section 19) with milestone options derived live from the textarea (M1, M2…).
Buttons: **Create project**, **Cancel**.
On submit: validate allocations if any (validAlloc); build phases `{id, no:i+1, name, amount, billing:'pending'}`; upload docs; `projects/{slug-xxxx}.set({... status:'active', baselines:[]})`; admin saves costing (mapping draft ms ids `n0..` → real phase ids) if anything entered; if created from a won deal (`dealLink`) set `deal.projectId`. Select the new project, close form, toast "Project created".

### 11.3 Status filter chips
`All N`, `Initiated N`, `Active N`, `On hold N`, `NPA N`, `Completed N`, `Closed N` (persisted `sab_pf`).

### 11.4 Project list table (`table.grid`)
Columns: chevron | Project (name, "client or Internal, P{priority}") | PM | Model (T&M/Fixed + type) | Status / health (stat pill + inline status select) | Progress (bar + "x%, d/n tasks") | Planned end | Forecast end (+"+Nd late"/"Nd early") | Next milestone ("M2 5 Nov" + name) | admin: Contract, Projected margin (red if loss, amber <15%).
Sorted: open first, then priority. Click row toggles expansion (detail row renders project body inline). Changing the status select → `setProjStatus` (prompts "Reason for moving {name} to {label}? (optional)" for hold/npa/closed; appends statusHistory; toast "{name}: {label}").

### 11.5 Expanded project body (`renderProjects`)
1. **Summary card**: name; "client, PM X, priority N, Product, fixed cost"; spanText; Status select; **Edit project** / **Close edit** button; progress bar; KPIs: Complete (Xh of Yh earned) · SPI (earned ÷ planned hours) · CPI (estimate ÷ actual hours) · schedule variance "+Nd" ("Forecast end X vs planned Y") · Milestones achieved "d / n" (x% on time) · On-time task delivery · Tasks breached / forecast to breach · Planned end from task dates (cpm finish; red if > plannedEnd).
2. **Edit project** form (when open): name, client, PM, start, planned end, type, commercial model, priority 1–4, status; **Save changes** / **Cancel**; Status history list "{date}: From → **To** by X (note)". Validation "Planned end is before the start." Toast "Project updated".
3. **Milestones** card — intro "A milestone's deadline is always the target end of its last task. Numbers are fixed once given (M1, M2… and 1.1, 1.2…). A milestone with no tasks is removed automatically after 7 days, unless it has been invoiced."
   Table: Milestone (M#, name, N tasks) | Progress | Deadline (+ "baseline X, ±Nd") | End (achieved/forecast) | Status chip | Billing (amount + billing select) | Edit / Delete. Inline edit row: name + amount, Save/Cancel ("Give the milestone a name." / "Milestone updated").
   Billing summary: "Billing: ₹ paid, ₹ invoiced and unpaid, ₹ achieved but not invoiced (red), of ₹ total."
   Add form: "New milestone, e.g. UAT sign-off" + "Billing amount ₹ (optional)" → **Add milestone**.
4. **Critical path** card (if tasks): intro text; table Milestone | Deadline | Critical task(s) (WBS, title, ✓ if done, "ends X") | Next closest (float) "N working days"; "Longest dependency chain to the project end" chips `1.1 Title › 1.2 Title…`; **Dependency conflicts** list: "{WBS title} is planned to start X, but it depends on {WBS title}, which ends Y. Move its dates or remove the dependency."; "Circular dependency between 1.2, 1.3. Remove one link."
5. **Schedule** (Gantt): legend Planned (outline) / Critical (red outline) / Actual or forecast (fill) / Today (line) / Milestone deadline (diamond) / Forecast / achieved (coloured diamond). Line "Critical path: 1.1 (start to end) › … Ends X." Axis in working-day index from min to max of project start/end, today, forecast end, all task dates. Per milestone row: deadline diamond + forecast/achieved diamond coloured by state. Per task: planned bar (`cpm.ES..EF`) and forecast/actual bar (`fc.start..finish`), colour: done late r; risk high/breach r; med a; else g; opacity .75 if open. Critical tasks show date label in red.
6. **Work breakdown structure** table: WBS | Milestone / task (+ "after 1.1, 1.2") | Owner | Done % | Effort est / actual | Start plan / actual | Target end (+ "rev X") | End (actual or forecast; red if late) | Float to milestone ("0" red for critical). Milestone rows (`tr.phase`) show aggregates and **+ Task** button → quick-add row: auto WBS code, title, dependency select, assignee, complexity, hours (default 8), start (default max(first task start, today)), due (default start + 3 wd), **Add task** / Cancel. Validation: "Fill in the task, assignee, hours and dates.", "Target end is before the planned start." Toast "Task added and assigned to X".
7. **Import WBS (milestones and tasks)** (details) — section 11.6.
8. **Baselines** — section 11.7.
9. **Change requests** — section 11.8.
10. **Costing and margin** (admin, pill "Editors only") — section 19.
11. **Documents**: list (link to `/_blob/{id}`, "N KB, date"); upload input + **Upload** (toast "N documents uploaded"); non-editor "Uploading needs Editor access."
12. **Project throughput, last 8 weeks**.

### 11.6 WBS import
Columns: `Milestone, Task, Owner, Estimated hours, Start, End, Complexity, Depends on, Milestone billing`. Paste TSV/CSV (quoted CSV supported) or upload .csv/.tsv/.txt. Buttons: **Download template** (downloads `wbs-template.csv` or pastes it as TSV), **Preview**, **Import N tasks and M new milestones**.
Parsing rules:
- Header must contain columns starting with "milestone" and "task" else "The header needs at least Milestone and Task columns. Use the template." <2 rows → "Paste a header row and at least one task row."
- Milestone matched by name (case-insensitive) or created (`_new`, next no, amount from billing column digits).
- Owner matched by id, full name, or first name; missing → assigned to PM with issue "owner "x" not found, assigned to PM" / "no owner, assigned to PM".
- Dates `YYYY-MM-DD` or `DD/MM/YYYY` (also `.`/`-`, 2-digit year → 20xx).
- Complexity numeric or low/medium/high/very high; default 2.
- Issues shown in Check column: "no milestone", "no task name", "start or end date missing or unreadable", "end before start", "no estimate". Row `ok` only if milestone, title, both dates and end≥start → else "Skipped: …". OK with warnings amber.
- Depends on: list separated by `,`/`;` of task names or WBS codes (e.g. 1.2), resolved against imported + existing tasks.
- Imported task: `status:'new', progress:0, importedOn`. Toast "Imported N tasks".

### 11.7 Baselines
Intro "Freeze the plan at kickoff and at each approved re-plan. "On plan" then means against a plan that can't quietly move." Compare-with select (defaults to latest). KPIs: Baseline end date; Forecast end vs baseline (+Nd red); Effort, baseline → now "400h → 460h"; Effort change vs baseline (%: >10 r, >0 a). Save: name input ("Baseline name, e.g. Kickoff plan", default "Baseline N") + **Save current plan as baseline** → stores `end = cpm.finish || plannedEnd`, `bac`, milestone dues, task tuples. Toast "Baseline saved". Milestone table shows baseline date and variance.

### 11.8 Change requests
KPIs: Raised; Awaiting decision; Approved extra effort (h); Scope growth vs baseline = approved CR hours ÷ (baseline bac, or current bac − approved hours) ×100 (>15 r, >5 a).
List: "CR-{no} title [Awaiting decision|Approved|Rejected]", "Requested by X on D. Nh effort, N working days impact, billable ₹." Actions: **Approve**, **Reject** (proposed); **Add its tasks to the WBS** (approved → opens Tasks form prefilled with project, title "CR-{no}: {title}", hours = effort).
Form "Raise a change request": Change*, Requested by ("Client or internal"), Effort (h) default 8, Schedule impact (working days) default 0, Billable amount (₹), Reason → toast "CR-N raised". Approve toast: "Change request approved. Add its tasks to the WBS."

---

## 12. Screen — Tasks (`#tasks`)

### 12.1 Assign a task (collapsible form)
Fields: Task* (placeholder "e.g. Fee collection API with receipts") · Project (active projects, "No project") · Milestone (phases of project, "No milestone") · Assign to* · Complexity (Low/Medium[default]/High/Very high) · Estimated effort (h) default 8, step 0.5 · Planned start (default today) · Target end date (default today + 3 wd) · Status (New / Selected for development) · Backup resource (optional) · Note (optional) "Acceptance criteria, links, context for the assignee" · Depends on (checkbox list of project tasks with WBS, owner, "ends {forecast}"; "Choose a project to see its tasks.") · **Delivery forecast preview** · **Assign task**.

Preview (`renderPreview`, live on input):
- Needs assignee, hours, due; else "Fill in the assignee, effort and dates to see the delivery forecast."
- Warns if start or due is not a working day: "The planned start Sat 10 Oct is not a working day."
- "**{Name}**: forecast end **X** against target Y. Deliverable. | **Will breach.**" (simulate = queue with this task added + dep push).
- "Planned start X is before "{dep}" ends (Y)." for late deps.
- "{Name} already has Nh due in the next 10 working days; effort ratio ×1.20 (team default)."
- History check: using same-complexity closed tasks (person's if ≥3 else team's if ≥3): "History check: {Name}'s High tasks take ×1.35 their estimate. Realistic effort **Nh** (= hrs × P50 ratio), safe **Nh** (= hrs × P80 ratio) (from N closed tasks)."
- If breach: "Better fit: **X**, forecast end Y" (+ " (also late: move the date or cut scope)").
- Box green (`ok`) or red (`bad`).

`suggest(task, exclude)`: simulate for every other person; prefer on-time; then earliest finish; tie → higher on-time %.

Submit: validation "Target end is before the planned start."; task `no = nextTaskNo`; toast "Task assigned to X".

### 12.2 Filters + list
Filters: Person (Everyone), Project (All projects), Status (All statuses + each), "Show done" checkbox (only applies when Status filter is empty). List sorted by risk (breach, high, med, low, done) then due.

### 12.3 Task item (`taskItem`) — used everywhere
Line 1: WBS code, title, status chip ("In development 40%" for active group), risk chip (Breached/High risk/Medium risk/On track), **Critical**, "N open bugs", "{X} covering".
Meta: "Project / Milestone, Owner, High complexity, est. 16h, actual 18h | logged 6h, backup Y".
Dates: "Planned 5 Oct to 9 Oct[, revised 12 Oct (flagged 8 Oct, early|late)]. Actual 5 Oct to 10 Oct (1 working days late | on time)" or ". Forecast X to Y".
Dependency callouts: "Waiting on (N open)" chips `1.1 Title: Owner, done|{status}, ends X` (green done, amber, red if ends ≥ my start); "Blocks" chips `1.3 Title: Owner, starts X[, will be held up]`.
Note preview (≤140 chars), Proof link, risk why (if not low).
Actions (not readonly):
- Open task: **Status select** (all 10 statuses) · **Update progress** · **Flag slip** · **Reassign**
- Done task: **Reopen**
- Always: **Details and comments (N)** / **Hide details** · **Remove**
Inline pending panels:
- Done (triggered by choosing "Completed" in status): "Proof link (required)", "Actual hours (required)" (prefilled with logged hours) → **Confirm completed** / Cancel. Missing → toast "Add a proof link and actual hours. No proof, no progress." Sets status done, doneOn, progress 100, proof, actualHours, startedOn if empty; history entry.
- Flag slip: date defaulting to effDue + 2 wd → **Set revised date** (sets `flaggedOn` once, `revisedDue`). Toast "Slip flagged".
- Progress: number 0–95 step 5 → **Save progress** (if not-started → status dev, startedOn).
- Reassign: select other people (preselected best fit) → **Move task**; "Best fit: X, forecast end Y (still late)." Moves task copy with `reassignedFrom/On`. Toast "Moved to X".
- Reopen: status dev, clears doneOn/proof/actualHours; history.
- Remove: confirm "Remove this task? Its history will be lost."

Status change (`setStatus`): sets statusOn; active group sets startedOn if empty; blocked sets blockedOn; progress floor: dev 5, unit 60, fut 75, uat 90. History entry "X moved this from A to **B**". Toast "Moved to {Status}".

### 12.4 Details and comments panel (`threadPanel`)
- Note textarea; Backup resource select ("No backup"; hint "Covered by X (delegated until D | owner on leave today)." or "The backup takes over automatically on the owner's leave days."); Depends on checkboxes (same project tasks). **Save note, backup and dependencies** → sys history "updated the note, set X as backup, changed dependencies". "Note last updated by X on D".
- **Comments**: threaded (top-level + replies). Each: author, timestamp, type chip (Bug open/fixed, Question, Decision), text with **@FirstName** mentions highlighted, links/files, "Fixed by X on D"; buttons **Reply (N)**, **Mark fixed** (bugs). Reply box "Reply. Tag people with @FirstName." → **Post reply**.
- New thread: Type (Comment/Bug/Question/Decision), "Tag someone" select (inserts `@First`), text "Start a new thread. Tag people with @FirstName.", link "Link (optional): screenshot, build, document", file input (if assets API; else "Attaching files needs Editor access; paste a link instead."), **Post**, "Posting as {me}" / "Posting as no one: choose yourself in Timesheet & log".
- Validations: must have author ("Choose who you are in Timesheet & log first, so the comment has an author."); need text/link/file ("Write a comment first."); link must be http(s) ("Links must start with http:// or https://"). Toasts "Bug logged" / "Comment posted" / "Reply posted" / "Bug marked fixed" (also posts reply "Marked this bug fixed.").
- History (collapsible): status and sys entries.

---

## 13. Screen — Timesheet & log (`#log`)

Card **Logging for** (person select; "Your choice is remembered on this device and used for the Employee dashboard and as the author of your comments."). Locked to self for sales/emp roles. **This is me: link to my account** (if claude user id available) → sets `people.uid` (clears it from others). Notes: "{Name} is linked to your account. The board opens as you on any device." / "Your account is linked to {other}." / "Link once so the board always knows who you are." Auto-select linked person on load.

Sections hidden until a person is chosen.

### 13.1 Timesheet
Intro: "Hours per task and activity for the week shown above. Task hours become the task's actual hours and cost."
Status banner (section 23). Grid columns Mon–Sat (6 days) + Total. Day header shows "Off"/"Holiday"/"Leave" and greys the column.
- **Tasks** section: tasks with hours this week + pinned tasks (open). Label: WBS, title, "Project, Status, est. Nh, logged Nh".
- **Activities** section: activity rows with hours this week + draft rows (highlighted). Row controls: activity type select (grouped optgroups, order depends on person func), project select (hidden for leave), note, hours per day (0–16 step 0.5), × remove.
- Draft empty row always present when editable: "Choose a task or activity…" with optgroup "My tasks" (choosing `task:{id}` converts to a pinned task row, carrying typed hours).
- **Day total** row: coloured green ≥ target, amber ≥ 80%, red otherwise (for days ≤ today); "of 9h"; "excluding breaks" if breaks don't count.
- Summary: "This week: **Nh** logged (project tasks 20h, meetings 3h…). Target to date **Nh** at 9h a working day: **N%**."
- Buttons: **+ Add another row** (hidden), **+ Leave or holiday** (adds draft `lv-casual`), **+ Lunch, tea and stand-up** (adds lunch/tea/standup drafts not already present; else "Those rows are already on your timesheet."), **Copy rows from last week** (non-leave activity types/projects from last week as empty drafts + pin tasks with hours last week; toast "N rows copied from last week" / "No new rows to copy"), hidden task add select.
- Help: "Fill one row at a time: pick a task or activity in the empty row and enter hours. A new empty row appears as soon as you pick. A full-day leave row (9h) also marks you on leave for planning; a half day stays a working day."
- **Save draft** / **Submit for approval** (hidden when not editable).

Save (`saveTs`):
- If not editable: "This week is locked."
- Task inputs → `task.log[date]`; hours on a not-started task → status dev, statusOn, startedOn, progress ≥ 5.
- Draft rows with a type → new activity items (leave rows force projectId ''); existing rows updated; hours written.
- `syncLeaveFromTs`: for each working non-holiday day, leave-row hours ≥ MINH → add to leave dates with `src='ts'`; if later < MINH and src was ts → remove.
- Removing a saved row with hours: confirm "This row has Nh logged. Remove it and its hours?"

Submit: saves, then short days (working day hours < MINH) → confirm "Mon 5: 7h, Tue 6: 8h are below 9h. Short days may not be paid in full. Submit anyway?". If approver exists → `status:'submitted', submittedOn, approver, days, total`; toast "Submitted to X for approval". No approver → auto-approved (`decidedBy:'auto'`), toast "Submitted and approved".

### 13.2 End-of-day update
Date (bounded to the shown week), What I finished*, Proof link* ("Commit, screenshot or demo URL"), Blockers (optional). Proof missing → "Add a proof link. No proof, no progress." Saves `week.eod[date]`; toast "Update saved". List below (newest first): "Mon 5 Oct: text / link / Blocker: …". Changing date loads that day's entry.

### 13.3 Friday demo
Checkbox "Showed working software to the team" + "What was demoed" + **Save demo** → `week.demo`. Toast "Demo saved".

---

## 14. Screen — Weekly scorecard (`#board`)
Card: "Team score this week" big number (mean of scores), counts "N green, N amber, N red", colour strip proportional.
One button row per person: name, role, score (coloured), score cells (Delivery/Updates/Timesheet/Demo/Early warning [+Approvals] or sales/ops sets), flags "Red two weeks running: 1:1 due", "N tasks forecast to breach". Clicking a row sets logging person to them, switches to Employee dashboard. Empty: "No team members yet. Add the first one below."

---

## 15. Screen — Insights (`#insights`)
Intro: "Predictions and performance built from your own history: how long tasks really took against their estimates, who finishes on time, and how the team is trending. The more tasks are closed with honest hours, the sharper this gets." Empty: "Add projects and tasks to see predictions."

### 15.1 Monte-Carlo-style quantile simulation
`QS = [0.2, 0.35, 0.5, 0.65, 0.8, 0.9]`. `forecastAt(q)`: re-run queue + dependency forecast with each person's effort ratio = `quant(ratios, q)` (person if ≥3 closed tasks else team quantile if ≥3 else 1). Ratios here use `actOf(t)` (actualHours or logged hours).
`quant(a,q)` = linear interpolation on sorted array at index `(n-1)*q`.
- P50 = run at 0.5; P80 = run at 0.8.
- `endOf(ids, run)` = max finish.
- **Chance on time** = % of the 6 runs whose end ≤ due. Chip: ≥80 g, ≥50 a, else r.

### 15.2 Cards
1. **Delivery predictions** — intro "Each person's plan is re-run with their own history: P50 uses their typical effort ratio, P80 a bad-but-realistic one. Chance on time is the share of six runs (from their best 20% to worst 10% of tasks) that land by the date. Velocity-based uses the hours actually logged on the project in the last 20 working days."
   - Projects: Project (x% done, Nh left) | Planned end | P50 | P80 | At current pace (= `fromWd(TI + ceil(remainingHours / (hoursLoggedLast20wd/20)) - 1)`, "Nh a week lately" = perDay×5; "No recent hours"/"Done") | Chance on time vs plannedEnd.
   - Milestones: "Project **M{i}** name" | Deadline | P50 | P80 | Chance on time | Billing at stake. (Note: uses index+1, not `ph.no` — quirk.)
   - Tasks most likely to slip: open project tasks with chance < 80%, top 12: Task | Owner (+backup) | Target | P50 | P80 | Chance. Empty: "No open task is below an 80% chance of finishing on time."
2. **Estimation accuracy** — "Effort ratio is actual ÷ estimated hours on closed tasks. ×1.00 is perfect; ×1.30 means work takes 30% longer than planned. New task estimates are checked against this in the Tasks form." Tables By complexity / By person: Tasks | Typical ratio (median; ≤1.1 g, ≤1.3 a, else r) | P80 ratio | On time | Action: `m>1.1` "Add N% to estimates" (N=(m−1)×100), `m<0.85` "Estimates run N% high", else "Estimates are sound".
3. **Performance tracker, last 12 weeks** — delivery/mgmt people only. Weekly score `wkPerf` = mean of on-time % (tasks due that week, due ≤ today) and timesheet % (hours vs MINH target, capped 100). Weeks before the person's first log/joining are null. Columns: Person | Weekly trend (sparkline) | Direction | Tasks done | On time | Effort ratio (Σact/Σest) | Timesheet, 4 wks | Avg slip when late. Team sparkline = mean per week.
   `trendWord`: needs ≥4 non-null weeks; compare mean of second half vs first half; |d|<5 "Steady", d>0 "Improving +N", else "Declining −N".
   Footer "Sales and operations people are tracked on their own dashboards. Use this table in monthly one-to-ones: a declining trend two months running is the conversation to have."

---

## 16. Screen — Client view (`#client`)
Project select (all projects sorted by priority; persisted `sab_cl`). Copy: "A clean status report for the client: milestones, progress, what's done and what's next. No people scores, no costs." **Download report for the client** (only if downloads API) → standalone HTML `{name}-status-{date}.html` with header "Seereon Consulting & IT Services" (gold rule #B8912B, green #2F7D50 bars).
Report content:
- "Status report, 30 September 2026", project name, client, progress bar, "**x% complete.** On track to complete by X." or "Forecast completion X, N working days after the planned Y."
- **Milestones**: name | Target date (doneOn if achieved) | Status: hit/late → "Achieved", missed → "Delayed", risk → "At risk", ontrack → "On track", empty → "Planned"; risk/missed add ", now expected X".
- **Completed in the last two weeks** (done since `fromWd(TI-10)`); **Coming up in the next two weeks** (forecast finish ≤ `fromWd(TI+10)`).
- **Decisions and inputs needed from you**: tasks in UAT ("ready for your UAT") or feedback ("waiting for your feedback"); proposed CRs "Change request CR-N: title (₹), awaiting approval".

---

## 17. Screen — Team & settings (`#settings`)

1. **Team** table: Name | Role | Function (Delivery/Sales/Operations/Management) | Joined (date) | Reports to ("Default ({approver})" or "No one (self-approves)") | Access ("Auto ({derived role})" or explicit role) | Hours/day | admin: Monthly CTC (₹), Cost/day | **Save**, **Mark exited** (confirm "Mark X as exited today? They leave all lists but stay in attrition history."). Admin note: "Monthly CTC is stored in an editors-only area: Contributors can't read it. Cost per day = CTC ÷ average working days per month (from your calendar) × (1 + cost loading %), set in the Finance dashboard."
2. **Add a team member**: Name*, Role, Productive hours/day (default 6) → id = slug(name). Toast "Member added".
3. **Working hours and calendar** (editable by admin only): Minimum working hours per day (default 9), "Breaks count toward the minimum" (default on), Weekly off days (Sun–Fri checkboxes), Saturdays: "Every Saturday is off" / "Every Saturday is a working day" / "Selected Saturdays are off" (+1st–5th checkboxes), "Manager approval deadline (working days after submission)" (default 2, 1–10). Help: "Timesheets lock when their week ends. Each missed deadline counts as a lapse on the manager's Approvals KPI (part of their weekly score)." Note: "{WDPM} working days a month on average this financial year, after holidays." / "Only editors can change company settings." Footer: "The minimum is the timesheet target for every working day. Productive hours/day in the team table is separate: it is how many hours of task work planning and forecasts assume." Toast "Calendar saved".
4. **Leave**: Person, From*, To* → adds working days in range to `leave/{pid}`. List of upcoming leave (from 5 wd ago) with Remove. **Leave taken this financial year** table: Person | per leave type (days = hours ÷ MINH) | Days from timesheet | Days marked. "Days = leave hours logged ÷ 9h. Days marked includes leave added here."
5. **Delegations**: "When someone is away, delegate their open tasks to a colleague for a date range. The delegate sees the tasks on their dashboard and the tasks show who is covering." Delegate from, To, Scope (All projects / a project), From date, To date, Note ("e.g. Annual leave"). Validation "Choose two different people." / "Check the dates." Toast "{A}'s tasks delegated to {B}". List (ending ≥ 7 days ago) with "Active" pill and Remove.
6. **Holiday calendar** (admin): date + name + type (Company holiday / Optional holiday) → **Add holiday**; bulk "One per line: 2026-10-02 Gandhi Jayanti / Add (optional) at the end for an optional holiday" (error "Use one holiday per line, like 2026-10-02 Gandhi Jayanti"). List with "Optional" pill, "(falls on a weekend)". Footer: "Company holidays and leave remove capacity, so forecasts, utilisation and timesheet targets adjust. Optional holidays don't; people take them as leave from the timesheet."
7. **Quarterly appraisal report** (admin): quarter select (last 4 FY quarters, "Q2 FY26-27 (1 Jul – 30 Sep)"), **Build report**, **Download CSV** (`appraisal-{start}.csv`). Columns: Name, Role, Tasks due, Tasks done, On-time %, Late, Effort ratio, Avg slip (days), Hours logged, Hours available, Timesheet %, EOD update %, Demo %, Early warning %, Approvals on time %, Approval lapses. Formulas: tasks due in quarter; on-time = ok/(ok+late); ratio = median over tasks done in quarter; util = logH/avail; EOD% = min(1, eodCount/workingDays); Demo% = min(1, demosShown/Fridays); early warning = early flags / slips; approvals via apprKpi.

---

## 18. Screen — Rules (`#rules`) — verbatim copy

**Non-negotiable rules**
1. **No proof, no progress.** A task is done only with a proof link and actual hours.
2. **Bad news within 24 hours.** Hiding a delay is worse than the delay.
3. **Your date is your word.** Flag a slip before the target end date, never after.
4. **Priority order is fixed:** EduReon, then HRMS delivery, then client projects, then everything else.
5. **Scope changes only in writing,** through the PM, as new tasks in the WBS.
6. **End-of-day update by 18:30, progress % and status updated daily, Friday demo mandatory.**
7. **Every working day's timesheet reaches the minimum working hours** (tasks plus activities such as meetings and breaks).
8. **Testing findings are logged as bugs on the task,** with the developer tagged. Nothing is reported only on chat.
9. **A billable milestone is invoiced the day it is achieved.**
10. **Timesheets daily, submitted weekly.** Submit by the end of the week; the week then locks. Days in weeks that aren't approved are not paid.
11. **Managers approve within 2 working days.** Every miss is a lapse on the manager's Approvals KPI and lowers their weekly score.
12. **No change without a change request.** Scope added without an approved CR is unbilled work.
13. **Leave goes on the board before it's taken,** so plans and forecasts account for it. Log it on the timesheet as a leave row too.
14. **Every task names what it waits on and a backup.** Before going on leave, delegate your open work in Team & settings.
15. **Discuss a task in its thread, not on chat.** Reply under the comment you're answering and tag the person who must act.

**KPI definitions** (table, verbatim):
| KPI | Definition |
|---|---|
| On-time delivery | Completed tasks finished on or before the target end date ÷ completed tasks. |
| Effort ratio | Actual hours ÷ estimated hours, median of completed tasks. ×1.00 = spot on; ×1.30 = work takes 30% longer than estimated; ×0.80 = estimates are padded. Above ×1.3 means chronic underestimating. |
| Markup vs margin | Both use the same profit (price − cost). Markup divides it by cost; margin divides it by price. 60% markup = 37.5% margin. Margin can never reach 100%; markup can. |
| Sales variable | Paid only in a month where the salesperson's closed deals reach their target (default = their monthly CTC). |
| Task statuses | New, Selected for development, In development, Unit testing, Functional testing, UAT, Waiting for feedback, On hold, Blocked, Completed. Moving to a testing stage raises progress to at least 60% (unit), 75% (functional) or 90% (UAT). |
| Critical task | The task that sets its milestone's deadline, i.e. the latest planned end in the milestone, plus any task whose dependents would push it. Float is how many working days a task can slip before it moves its milestone. |
| Working days | Every day except the weekly off days and Saturday rule set in Team & settings, minus company holidays. Optional holidays are taken as leave. |
| Resource allocation | Each resource is allocated to a milestone (or all milestones) with a required start and end date. The same person can have several rows, one per milestone. |
| Resource cost | Cost per day × allocation % × working days between the resource's start and end dates. Cost per day = monthly CTC ÷ average working days per month × (1 + cost loading). |
| Milestone deadline | Always the target end date of the milestone's last task. It moves only when a task's target date moves. |
| % complete | Earned hours ÷ total estimated hours. Earned = estimate × progress %. |
| SPI | Schedule performance: earned hours ÷ planned hours to date. Below 1.0 means behind plan. |
| CPI | Effort performance: estimated ÷ actual hours on completed tasks. Below 1.0 means tasks cost more effort than planned. |
| Schedule variance | Working days between planned end and forecast end. Positive means late. |
| Utilisation | Forecast hours due in the next 10 working days ÷ capacity. |
| Timesheet | Hours logged this week ÷ available hours (capacity minus holidays and leave). Leave rows count toward the target; a full-day leave row marks the day as leave. |
| Scope growth | Approved change-request hours ÷ baseline effort. |
| Baseline variance | Working days between a milestone's baseline deadline and its current deadline. |
| Markup | (Price − cost) ÷ cost. Cost = Σ(resource cost per day × man-days) + maintenance, where cost per day = CTC ÷ average working days per month × (1 + cost loading). Additional costs and contingency are added on top. Positive is profit, negative is loss. |
| Planned margin | (Price − planned cost incl. contingency) ÷ price, from the saved costing. |
| Projected margin | Fixed cost: contract value (price + approved CRs) − projected cost. A resource allocated up to a milestone's deadline stays on until the milestone's forecast or actual end: a late milestone adds breach cost, an early one saves cost. Unplanned people's time is added; contingency stays as cost until the project closes. Time & resources: billing and cost follow logged hours. |
| Actual margin to date | (Earned revenue − cost to date) ÷ earned revenue, where earned revenue = contract value × % complete. |
| P50 / P80 date | The forecast re-run using each person's typical (median) and worst-realistic (80th percentile) effort ratio from their closed tasks. Chance on time is the share of six such runs that finish by the target. |
| Performance trend | Weekly average of on-time delivery and timesheet discipline over 12 weeks; direction compares the latest six weeks with the six before. |
| Gross margin | (Contract value − forecast cost at completion) ÷ contract value. Margin is on revenue; markup is on cost. |
| Net margin | (Revenue billed − payroll − overheads − other expenses) ÷ revenue billed, for the period. |
| DSO | Days sales outstanding: receivables ÷ average daily billing over the last 90 days. |
| Runway | Cash balance ÷ (monthly burn − recurring monthly income). |
| Win rate | Deals won ÷ deals closed (won + lost) in the last 180 days. |
| Weighted pipeline | Σ deal value × stage probability. Deal value = one-time value + 12 × monthly recurring. |
| Ops on time | Recurring responsibilities (payroll, filings, invoicing) completed by their due date ÷ all due. |
| Attrition | Leavers in the last 12 months ÷ average headcount. |
| Throughput | Tasks completed per week. |

**Weekly score**: "Delivery roles: Average of delivery (tasks due this week done on time), end-of-day updates, timesheet, Friday demo and early warning (slips flagged before the target date). 90+ green, 75–89 amber, below 75 red. Two red weeks in a row means a 1:1 with Santosh." / "Managers get one more cell, **Approvals**: timesheets approved or rejected within the deadline ÷ all that fell due that week. A late or still-pending approval is a lapse and pulls the score down." / "Sales roles: activities logged (target 15 a week), follow-ups on time, new leads (target 2 a week), end-of-day updates and timesheet. Operations roles: recurring responsibilities on time, end-of-day updates and timesheet."

**How the schedule and forecast work**: "**Critical path** uses your planned dates exactly as entered. In each milestone, the task with the latest planned end is critical because it sets the milestone deadline; other tasks show how many working days they can slip first. Dependencies (finish-to-start) are checked: a task planned to start before its predecessor ends is flagged as a conflict, and a predecessor that would push a critical task becomes critical too." / "**Forecast** lines up each person's open tasks by target date against their productive hours per day, scales estimates by their historical effort ratio, and pushes tasks that wait on late predecessors. A task is high risk when its forecast end passes its target date or it is blocked." / "Working days follow the company calendar in Team & settings. Predictions sharpen as actual hours are logged."

**Consequences**: "One miss: reminder. Two in a month: formal 1:1. Three: written warning linked to appraisal. The board decides, not mood."

---

## 19. Costing, margin, markup (admin only)

### 19.1 Cost per day
```
dayCost(pid) = monthlyCTC / WDPM * (1 + loadPct/100)      // 0 if no CTC
hrCost(pid)  = dayCost(pid) / capOf(pid)                   // per productive hour
```
`WDPM` = FY working days (excl. holidays) ÷ 12. `loadPct` = "Cost loading on CTC (%)" from Finance settings.

### 19.2 Cost widget (`costWidget`) — used in Create project and Project → "Planned costing"
Span line: spanText + "Total man-days: **N** across K resources." (or "Set the project start and end dates to calculate working days and man-days.")
**Resources** table: Resource (person) | Milestone * (`—`, `All` = `*`, `M1`… with tooltip "M1 name (from – to)") | Alloc. % (default 100, step 5) | From * | To * | Working days | Man-days | Cost/day ("No CTC" if missing) | Cost | ×.
Legend under table: "**M1** Name (5 Oct–20 Oct) · **M2** …". Help: "Choose the milestone each person works on; From and To are required and default to that milestone's dates. Add the same person again for another milestone. Billing runs across every working day in the range, whether or not hours are logged."
Buttons: **Add resource**, **Suggest allocation from task estimates** (existing projects only).
**Additional costs** table: Category (COST_CATS) | Description ("e.g. AWS for 12 months") | Amount (₹) | × ; **Add cost**.
Inputs: Maintenance / support cost (₹); Contingency (% of resources and additional costs, 0–50); Markup (%) default 20; Project price (₹) — label "Estimated billing (₹)" for T&M.
Hidden `mode`: typing in Markup → mode `markup` (price computed); typing a price > 0 → mode `price` (markup computed).
Selecting a milestone auto-fills From/To with that milestone's first task start / last task due (or project dates for All).
Missing required fields get a red outline.

Summary KPIs: Resource cost (N man-days) · Additional and maintenance costs · Contingency (N%) · Total cost; then Project price / Estimated billing · Profit or Loss (red) · Markup on cost · Margin on price. Warning "N resources have no monthly CTC. Set it in Team & settings." T&M note: "Time & resources: each resource bills at cost per day × (1 + markup). Actual billing follows logged hours."

Suggest allocation: for each (person, milestone) sum `estHours / capOf(pid)` = man-days needed; `pct = clamp(5,100, round(md / workingDaysInRange * 100 / 5) * 5)`. Toast "Allocation suggested from task estimates".

### 19.3 `calcCost(c, {start,end})` (planned)
```
md(a)   = a.pct set ? spanInfo(a.from||start, a.to||end).wd * pct/100 : a.md      // legacy
res     = Σ dayCost(a.pid) * md(a)
extras  = Σ extras.amount
maint   = maintenance
cont    = (res + extras) * contingency/100
cost    = res + extras + maint + cont
if mode=='price' && price>0: markup = (price - cost)/cost*100
else:                        price  = cost * (1 + markup/100)
profit  = price - cost
margin on price = profit / price * 100
```
Validation on save (`validAlloc`), per row with a person: "{Name}: choose a milestone." / "{Name}: start and end dates are required." / "{Name}: the start date is after the end date." / "{Name}: set an allocation above 0%." Save → `finance/cost/projects/{id}` + `{billing,start,end,updatedOn}`; toast "Costing saved". Unsaved edits survive re-renders (`data-dirty`).

### 19.4 Projected financials — `projFin(pr)` (L1516)
Inputs: saved costing `f`, project dates, tasks, activity rows with projectId (excluding break/leave kinds), approved CRs.
```
actHrs[pid] = Σ actOf(task) for project tasks + Σ activity-row hours tagged to project
remHrs[pid] = Σ fc.rem of open project tasks
ME = msEnds(pr): per milestone {due = max estDue, fEnd = max(done?doneOn:forecast finish), done, amount};
     '*' = whole project {due: plannedEnd, fEnd: max end}
crVal = Σ amount of approved CRs
T&M:
  actCost = Σ actHrs[pid]*hrCost(pid)
  eac     = actCost + Σ remHrs[pid]*hrCost(pid) + maint + extras
  contract= eac*(1+markup/100) + crVal
Fixed:
  for each alloc a: s0=a.from||start, e0=a.to||end, m=ME[a.msId||'*'], D=m.due||end, F=m.fEnd||D
     eP   = (e0 >= D) ? F : e0            // allocated up to the deadline → stays until real end
     plan = dayCost*wd(s0,e0)*pct
     proj = eP<s0 ? 0 : dayCost*wd(s0,eP)*pct
     acc  = TODAY<s0 ? 0 : dayCost*wd(s0,min(TODAY,eP))*pct   // accrued to date
     delta= proj - plan
  breach   = Σ max(0,delta)   ("Breach cost: people held on late milestones")
  early    = Σ max(0,-delta)  ("Early finish saving")
  unplanned= Σ over people NOT in allocation: actHrs*hrCost + remHrs*hrCost
  actCost  = Σ acc + unplanned-actual part
  eac      = Σ proj + extras + maint + unplanned + (projDone ? 0 : cont)
  contract = price + crVal
pctDone   = PK.pctDone ; earned = contract*pctDone/100
fMargin   = contract - eac                    (projected profit)
fMarginPct= (contract-eac)/eac*100            (projected MARKUP; unused in UI)
plannedPct= profit/price*100                  (planned margin)
projPct   = (contract-eac)/contract*100       (projected margin)
todayProfit = earned - actCost ; todayPct = (earned-actCost)/earned*100   (actual margin to date)
msVar[] per milestone: slip = wdDiff(due,fEnd), plan, proj (alloc rows on that ms)
```
projDone = project status done or all tasks done.

### 19.5 Project "Costing and margin" card
Intro: "{Fixed cost|Time & resources} {type} project. Planned is the saved costing; projected adjusts for breaches, early finishes, CRs and unplanned time; actual to date is earned revenue against cost so far."
- Table rows Revenue / Cost / **Profit** / **Margin** × columns Planned / Projected / Actual to date (Revenue projected shows "incl. CRs ₹"; actual shows "earned at N% done"). Margin colour: <0 r, < planned−5 a, else g.
- **What moved the margin** (fixed only): Planned profit, + Approved change requests, − Breach cost: people held on late milestones, + Early finish saving: milestones ahead of deadline, − Unplanned time: people not in the allocation, + Contingency released at close (if done); = **Projected profit**. Note "Contingency of ₹X is still held as cost. If it isn't needed, projected profit rises to ₹Y at close."
- **Milestone variance**: Milestone (Done pill) | Deadline | Forecast or actual | Slip ("+Nd late"/"Nd early"/"on time") | Planned cost | Projected cost | Change. Note on "All milestones" following project forecast end.
- **Resources: allocated vs logged**: Resource | Allocated man-days | Allocated to date | Logged days to date (= actHrs / capOf) | Allocation used (logged/allocatedToDate %; <60 r, <85 a; "unplanned" if no allocation) | Planned cost. Note: "Allocation used below 100% means paid time on this project isn't showing up as logged work: either timesheets are incomplete or the allocation is too generous."
- **Planned costing** widget + **Save costing**. "No costing saved yet." when absent.

### 19.6 Margin roll-ups
- `finOf(p)`: admin → from projFin: `{contract, eac, actCost, earned, profit=fMargin, marginPct=projPct, plannedPct, todayPct, breach, early, markup}`; non-admin → `margins/{id}` doc.
- `syncMargins()` (admin, debounced 1.5 s): writes rounded finOf values to `margins/{id}` when changed (so PMs see margins without CTCs).
- `orgTotals(list)`: `c=Σcontract, e=Σeac, a=ΣactCost, er=Σearned, profit=c−e, pct=(c−e)/c*100, todayPct=(er−a)/er*100, loss=#projects with profit<0`.
- **Profit margins** card: KPIs Contract value (N active projects), Projected gross profit, Projected gross margin (<0 r, <15 a, g), Actual margin to date; table Project | Contract | Planned margin | Projected margin (+"±N pts" vs planned) | Actual to date | Projected profit | Cost to date | Projected cost. Row click → open project. Footer "Tap a project to drill into its costing, resources and milestones." + "N projects heading for a loss."
- Project list column "Projected margin" colour: profit<0 r, marginPct<15 a, else g.

---

## 20. Finance dashboard (`financeDash`, admin only; CEO → Finance)

Non-admin: "The finance dashboard is visible to editors only."

### 20.1 Sources
- `invoiceList()`: (a) project milestones with amount and billing invoiced/paid → `{src:'ms', amount, date: invoicedOn, paidOn: paid ? (paidOn||invoicedOn) : null, cat: project type label}`; (b) ledger income: recurring monthly → one row per month from `date` to min(until,today) on the same day-of-month, treated as paid on that date; one-off → `paidOn = status==='received' ? (receivedOn||date) : null`.
- `expenseList(upto)`: ledger expenses (recurring expanded monthly).
- `payrollIn(month)` = Σ monthlyCTC of all people (incl. exited) employed in that month (joinedOn ≤ month ≤ exitedOn).
- overheads = `fset.overheads` monthly.

### 20.2 Formulas
```
rev(a,b) = Σ invoices with date in [a,b]      col(a,b) = Σ invoices with paidOn in [a,b]
receivables = invoices with no paidOn ; recvT = Σ
DSO  = round(recvT / (rev(TODAY-90, TODAY)/90))                   // days
aging buckets by days since invoice date: 0–30, 31–60, 61–90, >90
burn = payrollIn(thisMonth) + overheads + Σ active recurring expenses
mrr  = Σ active recurring income (date ≤ today, until ≥ today)
runway = (burn - mrr) > 0 ? cash / (burn - mrr) : "Cash positive"   // months; <6 r, <12 a
monthly P&L (last 6 months): cost = payroll + overheads + expenses; net = billed - cost
FY: fyRev = rev(fyStart, TODAY); fyCost = Σ over FY months so far (payroll+overheads+expenses)
netMargin = (fyRev - fyCost)/fyRev*100   (<0 r, <10 a)
revenue per employee (annualised) = fyRev / monthsElapsedInFY * 12 / headcount
bench cost next 10 wd = Σ_people max(0, load.cap - load.hrs) / capOf * dayCost
billable in 30/60/90 days = Σ amount of open milestones with (fEnd||due) ≤ today+N calendar days
CEO earnings(): mRev(m)=billed in month, mCol(m)=collected in month, mCost(m)=payrollIn(m)+overheads+expenses(m); agg(months) → {r,c,k,net=r-k}
Revenue change % = (cur - prev)/|prev|*100; FY compares FY-to-date vs last FY start → same month last year
```
### 20.3 Cards
1. **Finance** KPIs (16): Revenue billed, financial year to date · Revenue billed, Q# · Revenue billed this month · Collected this month · Net margin, FY to date · Projected gross margin, active projects · Receivables (N invoices) · Days sales outstanding (>60 r, >45 a) · Monthly burn (payroll + overheads + recurring costs) · Recurring monthly income · Cash balance · Runway · Payroll this month · Revenue per employee (annualised) · Bench cost, next 10 working days · Billable in 30 days (60: ₹, 90: ₹).
2. **Monthly P&L, last 6 months**: Month | Billed | Collected | Payroll | Other costs | Net (billed − costs). Note "Payroll uses current CTCs for everyone employed in that month."
3. **Revenue mix, financial year to date** (hbars by category with %).
4. **Receivables**: aging KPIs + list "label, ₹, invoiced D, N days" with **Mark paid** (milestone → billing paid, paidOn; ledger → status received, receivedOn). Toast "Marked paid".
5. **Profit margins** (org).
6. **Ledger**: "Income and costs outside project milestones: SAP consulting, subscriptions, rent, tools." Last 15 entries: "note, Income|Expense, category, ₹ [per month], from D [to D], received|awaiting payment" + Remove (confirm "Remove this ledger entry?"). Form "Add an entry": Type (Income/Expense), Category (SAP consulting, Product licence, Subscription / AMC, Services, Rent, Tools & software, Marketing, Travel, Other), Amount (₹)*, Date (today), Repeats monthly, Until (optional), Description ("e.g. SAP consulting, client X"), Status (one-off income): Received / Invoiced, awaiting payment. Toast "Entry added".
7. **Finance settings**: Cash balance (₹), Monthly overheads (₹), Cost loading on CTC (%). "Cost loading adds a share of rent, tools, leave and bench time to every hour of project cost, so project margins aren't flattered by using bare salary." Toast "Finance settings saved".

---

## 21. Sales CRM and compensation

### 21.1 Constants
Stages (key, label, probability %): lead Lead 10 · qualified Qualified 25 · demo Demo done 40 · proposal Proposal sent 60 · negotiation Negotiation 80 · won Won 100 · lost Lost 0.
Products: EduReon, SeerHR, Custom software, SAP consulting, Other. Sources: BNI, Referral, LinkedIn, Website, Cold outreach, Existing client. Activity types: Call, Meeting, Demo, Email, Proposal, WhatsApp (+ "Note" from lead creation). `SALES_ACT_TARGET = 15`/week.
`dealVal(d) = value + 12 * mrr`. `lastAct(d)` = latest activity date.

### 21.2 Sales dashboard (`salesDash`)
Page head "Sales" / "N open deals, ₹ pipeline" + **+ New lead**.
**New lead** form: Opportunity* ("e.g. EduReon for 2 campuses"), Company or school*, Contact person, Phone, Email, Product (default EduReon), Source (default BNI), Owner (sales people or everyone; default me), Stage (Lead/Qualified/Demo done/Proposal sent), One-time value (₹), Recurring (₹/month), Expected close (today+30), Next step ("e.g. Book demo"), By (today+2 wd), "How the lead came in / first conversation" → creates deal with stageHistory `[{from:'',to:stage}]` and optional Note activity. Toast "Lead created". **Cancel**.
**Pipeline** KPIs (12):
```
Open pipeline = Σ dealVal(open), N deals
Weighted pipeline = Σ dealVal × stage%/100
Won in Q# = Σ dealVal won in current FY quarter (count)
Forecast to close in Q# = weighted value of open deals with expectedClose in quarter
Win rate, last 180 days = won/(won+lost) closed in 180d   (RAG 30/20)
Average deal size (won) = Σ dealVal(won)/count
Median sales cycle = median(wonOn - createdOn days)
Recurring revenue won (per month) = Σ mrr of won
New leads this month (≥8 g, ≥4 a, else r)
Sales activities this week
Follow-ups overdue (nextDate < today, open)
Deals with no activity in 14 days
```
**Funnel** hbars per stage (excl. lost): Σ dealVal, "N deals". **Lead sources** table: Source | Deals | Open pipeline | Won | Won value | Win rate. **By product** hbars (open). **Salespeople** table: Person | Open deals | Pipeline | Activities this week "N / 15" (≥15 g, ≥8 a) | Won this quarter | Overdue follow-ups | Week score. **Needs attention** (overdue or stale deals). **Open deals** (sorted by probability desc, expected close). **Sales cost vs deals closed** (admin). **Salesperson performance**. **Sales activity log, last 30 days** (filter by person; Date | Who | Deal | What | Detail; max 40). **Won and lost (N)** collapsible.

Deal item: title + stage chip; "client (contact, phone), product, via source, owner X"; "₹value + ₹mrr/month, 40% probability, expected close D. Last activity D|never." or "won D" / "lost D: reason"; "Next: text, by D (overdue)". Actions for open deals: stage select, **Log activity** (type + "What happened" → **Save activity**, toast "Activity logged"), **Next step** (date default +2 wd + "Next step, e.g. send proposal" → **Save next step**). Won without project: **Create project** (opens create-project form prefilled with title, client, type product if EduReon/SeerHR else service, price = value in price mode; links deal). "Project: X". **Timeline (N)** toggles event list (Lead created (source), Stage A → B, activities, Won/Lost).
Stage change: to `lost` opens inline "Why was it lost? (required)" → **Mark lost** (error "Record why it was lost: that is how the win rate improves."); to `won` sets wonOn, toast "Deal won. Create its project next."; else "Stage updated". Appends stageHistory.

### 21.3 Compensation — `compOf(pid, month)` (L1966)
```
ctc      = monthlyCTC
vp       = rates.variablePct ?? (func==='sales' ? 20 : 0)          // % of CTC that is variable
target   = rates.salesTarget || ctc                                  // monthly target, default = CTC
closed   = Σ dealVal of deals won by pid in that month
base     = ctc * (1 - vp/100)
variable = ctc * vp/100
ach      = closed/target*100
earned   = ach >= 100 ? variable : 0                                 // all-or-nothing monthly
payout   = base + earned
```
`compPeriod(pid, per, key)` for month/quarter/year: sums monthly results for months ≤ current month; `monthsHit` = months with ach ≥ 100; period `ach` = Σclosed/Σtarget.

**Sales cost vs deals closed** card (admin): period switch Month / Quarter / Year + period select (last 12 months / 6 quarters / 3 FYs). KPIs: Sales salaries (N people) · Deals closed · Closed ÷ salary cost (≥100% g, ≥50% a, else r) · Payout (base + variable earned). Table: Salesperson (N deals won: titles) | CTC in period | Variable % (editable) | Monthly target (editable) | Target in period | Closed | Achieved (≥100 g, ≥50 a) | Months target met | Variable earned | Payout | **Save** (writes `variablePct`, `salesTarget`). Team total row. **Trend by month/quarter/year**: Sales salary cost | Payout | Deals closed | Closed ÷ salary. Note "Variable pay is decided month by month: it's paid only in a month where that month's target is met, so a quarter or year shows the sum of monthly payouts. Default target = the person's monthly CTC. Deal value = one-time value + 12 months of recurring. Months still to come in a quarter or year are not counted."

**Salesperson performance, {period}**: Activities, Calls, Meetings, Demos (stage→demo in period + Demo activities), Proposals (stage→proposal in period), New leads, Won (+value), Lost, Win rate, Avg deal, Sales cycle (median days), Open pipeline, Weighted, Overdue follow-ups, Idle deals (14d); admin: Target achieved, Closed ÷ salary. Then "Last 6 months: {person select}" table Month | Activities | New leads | Deals closed (bar) | admin: Target | Achieved | Variable earned.

Sales person scorecard: see 9.2.

---

## 22. Operations

Page head "Operations" — "The back office: paying people correctly, statutory filings, hiring, and turning finished work into cash." Intro grid: **1. Recurring duties** "Are payroll, PF/ESI, GST, TDS and other repeating jobs done on time, and by whom?" · **2. People & timesheets** "Headcount, hiring, leave, and whether timesheets are submitted and approved on time." · **3. Payroll** "What each person is paid this month: salary minus days whose timesheets weren't approved, plus sales variable if earned." · **4. Invoicing & collections** "Is finished work being invoiced the same day, and is the money coming in?"
Sub-tabs: **Recurring duties · People & timesheets · Payroll · Invoicing & collections**.

### 22.1 Recurring duties
Period logic (`periodFor`): weekly → key = Monday, due = Monday + (dueDay−1) capped Fri; monthly → key `YYYY-MM`, due = day `min(dueDay,28)`; quarterly → key `YYYY-Q#` (calendar quarters), due = first month of quarter day min(dueDay,28). State: logged done ≤ due "Done on time"; logged later "Done late"; not logged & due < today "Overdue"; else "Upcoming".
`opsStats(items)` = on-time % over periods due in last 90 days. `opsOpen` = overdue (last 60 days) + upcoming within 10 days.
Cards: **Recurring duties** intro "Jobs that repeat every week, month or quarter, such as payroll, PF and ESI, GST, TDS and invoicing. Each has an owner and a due day. When it's done, the owner clicks Mark done; anything late or missing shows up here." KPIs Duties done on time, last 90 days (RAG 95/85) · Overdue now · Due in the next 10 days · Recurring responsibilities tracked. **Due and overdue** list (title + state chip; "area, freq, owner X. Due D for {key}." + **Mark done** → `log[key]=TODAY`, toast "Marked done"). **On time by area** and **By owner** hbars (<85 r, <95 a; "no history"). **Where operations time goes, last 30 days** (ops people's activity hours by type, top 12). **Add a recurring responsibility**: Responsibility* ("e.g. PF and ESI filing"), Area (HR, Payroll, Finance, Compliance, Admin, IT), Owner, Frequency (Monthly/Weekly/Quarterly), "Due day (day of month; for weekly, 1 = Monday … 5 = Friday)" default 7. Toast "Responsibility added".

### 22.2 People & timesheets
**People and HR** KPIs: Headcount · Joiners / leavers, last 12 months · Attrition, last 12 months = leavers ÷ ((headcount now + headcount 12 months ago)/2) ×100 (>20 r, >10 a) · Open roles · Median time to fill (days) · Timesheet compliance this week (mean of people's timesheet cell; <90 a) · Leave days booked, next 30 days · People without a joining date. **Open roles** list ("open N days, N in pipeline", **Mark filled**) + add form (role, candidates) → toasts "Role added", "Role marked filled".
**Timesheet discipline** (`approvalStatsCard`): "Employees submit by the end of each week; managers approve within N working days. Days in weeks that aren't approved are not paid." KPIs: Timesheets submitted on time, last 8 weeks (submittedOn ≤ week Sunday) · Not submitted for last week (list names) · Waiting for approval · Approvals overdue. **Approvers** table: Manager | Pending | Overdue now | Decided, last 8 weeks | Lapses (late or overdue) | Avg working days to decide.

### 22.3 Payroll (admin; else "Payroll is visible to editors only.")
Intro: "Rule: a working day is paid only if its week's timesheet was submitted and approved. Unapproved days and leave without pay are deducted from the base salary (base ÷ working days in the month, per day). Sales variable is added only if the month's target was met."
Month select (last 6; default previous month if today ≤ 10th) + **Calculate payroll / Recalculate / Calculating…**.
`runPayroll()`: loads all week docs overlapping the month. For each person employed in month (incl. exited within month):
```
for each working non-holiday day d in month within joined..exited:
  work++
  lwp: Σ 'lv-lwp' hours on d ≥ MINH → +1 ; >0 → +0.5
  week ts status approved → ok++
  else if week not yet over (Sun ≥ today) or status submitted → pend++
  else bad++ (badDays)
c = compOf(pid, month)
rate = c.base / work
ded  = rate * (bad + lwp)
net  = max(0, c.base - ded + c.earned)
```
KPIs: Monthly CTC, all staff · Deductions (N unapproved days, N LWP days) · Sales variable earned · Net payable. Table: Person (approver X / self-approves) | Working days | Approved | Pending | Not approved (tooltip dates) | LWP | CTC | Base | Deduction | Variable | Net payable. Note "Pending = the week isn't over yet or is waiting for the manager. Run payroll after every week of the month is approved; pending days become deductions if they stay unapproved."
(Note: pending days are not deducted in the calculation.)

### 22.4 Invoicing & collections (Finance operations)
KPIs: Milestones achieved, not invoiced · Median working days, achieved to invoiced (>2 a) · Unpaid invoices (admin) · Unpaid for over 30 days (admin). List "Project: Milestone — Achieved D, N working days ago, ₹ to invoice."

---

## 23. Timesheet workflow, approvals, SLA, lock

- Week = Monday..Sunday (grid shows Mon–Sat). State `tsState(pid, wk)`:
  - `approved` / `submitted` / `rejected` from `ts.status`
  - else `locked` if `TODAY > wk+6` (week ended) and not (`unlockUntil ≥ TODAY`)
  - else `open` (Draft)
- Editable only in `open` or `rejected`.
- Approver `approverOf(pid)`: `reportsTo` (if valid, not self) else "top boss" = first person with func `mgmt` (or first person) unless that's the person themself → null (self-approves → auto-approve on submit).
- SLA = `company.approvalSla || 2` working days. Due = `addWorkdays(submittedOn, SLA)`; lapsed if `TODAY > due`.
- Status banner copy:
  - Draft: "**Draft.** Save as you go and submit by Sun 11 Oct. After that the week locks."
  - Submitted: "**Submitted** on D. Waiting for X to approve by D. You can't edit it now."
  - Approved: "**Approved** by X|auto-approval on D. This week counts for salary."
  - Rejected: "**Sent back** by X: “reason”. Fix it and submit again."
  - Locked: "**Locked.** This week ended on D without being submitted, so its days are not paid until it's submitted and approved. [Unlock requested on D; waiting for X.]" + button **Ask manager to unlock** (sets `unlockReq`, toast "Unlock requested from X").
  - Unlocked: "**Unlocked by X until D.**"
- **Timesheet approvals** card (shown on PM + Employee dashboards for approvers): title with "N waiting" pill (red if any lapsed); intro "Approve or reject within N working days of submission. Each one you miss is a lapse on your Approvals KPI and pulls down your weekly score." KPIs (managers): Approvals on time, last 30 days · Approval lapses, last 30 days (negative KPI) · Overdue right now · Waiting, within deadline. Table: Person ("Submitted D" / "Asked to unlock a locked week") | Week | Hours by day (Mon–Sat, short days red) | Total (+ "N short days") | Due by (+ **Overdue**) | actions: **Approve** · reason input "Reason to reject" + **Reject** · or **Unlock**. Plus "My team's timesheets" grid: last 4 weeks status pills (Approved/Submitted/Rejected/Locked/Draft) with **Unlock** on locked.
- Actions (`canDecide`: I am the approver or admin; else "Only the approver can do this."):
  - Approve → `{status:'approved', decidedBy, decidedOn, late, reason:''}`; toast "Approved X's timesheet".
  - Reject → requires reason ("Give a reason so they know what to fix."); `{status:'rejected', …}`; toast "Timesheet sent back".
  - Unlock → `{unlockUntil: TODAY+1 wd, unlockReq:false, unlockedBy, unlockedOn}`; toast "Week unlocked for X until D".
  - `late` = TODAY > submittedOn + SLA.
- **Approvals KPI** `apprKpi(mgr, a, b)` over cached last-8-week docs: consider submissions whose due date falls in [a,b], approver = mgr, not auto: still submitted & past due → miss; submitted within due → pending; decided on/before due and not late → ok; else miss. `pct = ok/(ok+miss)`.
- **Lockout overlay** (`renderLockout`, defined but never called in prototype — see 28): if the logging person has lapsed approvals, full-screen card "You're locked out: N approvals are overdue" + table; "…Salaries can't be paid for days that aren't approved, so the board stays locked for you until each one is approved or rejected." / "Not X? Choose yourself in Timesheet & log on your own device. Every late decision is recorded against the approver."

---

## 24. Roles and "View as"

```
ROLES = {
  ceo:   {l:'CEO',             views:[ceo,pm,sales,ops,emp], tabs:[dash,projects,tasks,log,board,insights,client,settings,rules]},
  pm:    {l:'Project manager', views:[pm,emp],               tabs:[dash,projects,tasks,log,board,insights,client,rules]},
  sales: {l:'Sales',           views:[sales,emp],            tabs:[dash,tasks,log,rules]},
  ops:   {l:'Operations',      views:[ops,emp],              tabs:[dash,tasks,log,board,settings,rules]},
  emp:   {l:'Employee',        views:[emp],                  tabs:[dash,tasks,log,rules]}
}
```
- `meId()` = person linked to my claude uid, else `logPid` (device choice).
- `roleOf(pid)`: explicit `person.access` → that; func mgmt → ceo; func sales → sales; func ops → ops; owns an open project → pm; else emp.
- `curRole()`: admin (editor) → `roleView` ("View as", default ceo); non-admin → `roleOf(meId())`.
- `applyRole()`: hides tabs / dashboard views not in role; if current tab/view hidden, falls back to dash / first view.
- Self-lock: for roles other than ceo/pm/ops (i.e. sales, emp) with a known me: "Logging for" select disabled, Tasks "Person" filter forced to me and disabled, Employee picker disabled.
- **Admin-only (isAdmin, i.e. editor) content — independent of View as**: `.admin-only` elements (costing box on create, CTC note, appraisal card), CEO revenue card, org margin cards, Mix/Closed projects, finance dashboard, payroll, sales comp card and admin columns, CTC/Cost-day columns in team table, contract/margin columns in project list, Costing and margin card, company settings/holiday editing, milestone sweep, margin sync. Finance collections are not even subscribed for non-admins.
- Non-admin writes that fail with `invalid_argument` → "This change wasn't saved: you need Contributor access to this board."
- PMs see margins via `margins/*` without salaries ("Salaries are never shown here.").

---

## 25. Validations and business rules (consolidated)

Tasks
- Title + assignee required; target end ≥ planned start ("Target end is before the planned start.").
- Completion requires proof link AND actual hours ("Add a proof link and actual hours. No proof, no progress."). Choosing "Completed" in the status select opens the confirm panel rather than setting status.
- Manual progress capped 0–95; completion sets 100.
- Status progress floors: In development 5, Unit testing 60, Functional testing 75, UAT 90.
- Entering status in active group sets `startedOn`; logging hours or setting progress on a not-started task moves it to In development.
- Flag slip keeps the first `flaggedOn`; early warning counts only if `flaggedOn ≤ estDue`.
- Dependencies are finish-to-start; conflicts flagged when start ≤ predecessor end; cycles reported.
- Milestone deadline derived only from tasks; empty milestone auto-deleted after 7 days unless invoiced/paid; invoiced/paid milestones can't be deleted.
- Backup covers automatically on owner's leave day; delegation covers for a date range (optionally scoped to a project).

Projects
- Planned end ≥ start on edit ("Planned end is before the start.").
- Status change to On hold / NPA / Closed prompts optional reason; history logged.
- Costing allocation rows each need milestone, from, to (from ≤ to) and pct > 0.

Timesheet
- Editable only in Draft/Rejected (or unlocked until date). Week locks after Sunday if not submitted.
- Submit warns on days below minimum hours; allowed with confirm.
- Full-day leave row (≥ MINH hours) on a working day auto-marks leave; removing it un-marks only auto-added days.
- Breaks may be excluded from target (`breaksCount=false`).
- Leave-row hours on a day already marked leave don't double count toward target.
- One empty draft row at a time ("Fill in the open row first."; "Enter hours in the new row first.").
- Approver must decide within SLA; late decisions flagged `late` and counted as lapses; rejection needs reason; only approver or admin can decide.
- Payroll: a working day is paid only if its week's timesheet is approved; LWP full day = 1, partial = 0.5 deduction day.

EOD / demo
- EOD requires "What I finished" and proof link. Demo score 0 once Friday passes without demo.

Sales
- Lost requires reason. Deal value = one-time + 12×MRR. Variable pay all-or-nothing per month at ≥100% of target.

Comments
- Author required; http(s) links only; mentions detected by `@FirstName` (case-insensitive, not followed by a letter).

Settings
- Delegation: two different people, end ≥ start. Holidays: bulk format `YYYY-MM-DD Name [(optional)]`. Company settings and holidays editable by admin only.

Uploads
- Types: pdf, png, jpg, jpeg, webp, gif, svg, txt, md, csv, json; ≤ 20 MB; errors "{file} wasn't uploaded: unsupported file type (save Word/Excel as PDF) | over 20 MB | upload failed."

---

## 26. Toasts, confirms, prompts, error copy

Errors (`errMsg`): `invalid_argument` → "This change wasn't saved: you need Contributor access to this board."; `quota_exceeded` → "The board's storage is full. Ask Santosh to archive old data."; else "This change wasn't saved. Check your connection and try again."

Toasts (non-exhaustive, all verbatim): "Task assigned to X" · "Moved to {Status}" · "Slip flagged" · "Moved to X" · "Details saved" · "Bug logged" · "Comment posted" · "Reply posted" · "Bug marked fixed" · "Draft saved" · "Submitted to X for approval" · "Submitted and approved" · "This week is locked." · "Unlock requested from X" · "Approved X's timesheet" · "Timesheet sent back" · "Week unlocked for X until D" · "Only the approver can do this." · "Update saved" · "Demo saved" · "Project created" · "Project updated" · "{Project}: {Status}" · "Milestone added" · "Milestone updated" · "Milestone deleted" · "Billing status saved" · "Baseline saved" · "CR-N raised" · "Change request approved. Add its tasks to the WBS." · "Change request rejected" · "Costing saved" · "Allocation suggested from task estimates" · "Imported N tasks" · "Nothing to import." · "Member added" · "Saved" · "Marked as exited" · "Leave added" · "Calendar saved" · "Holiday added" · "N holidays added" · "{A}'s tasks delegated to {B}" · "Delegation removed" · "Lead created" · "Activity logged" · "Next step saved" · "Stage updated" · "Deal won. Create its project next." · "Responsibility added" · "Marked done" · "Role added" · "Role marked filled" · "Entry added" · "Finance settings saved" · "Marked paid" · "Linked to your account" · "Choose who you are first." · "Milestone chosen: fill in the task and assign it" · "The report couldn't be downloaded." · "The CSV couldn't be downloaded." · "Downloads are not available in this view."

Confirms: remove task; remove timesheet row with hours; delete milestone; mark exited; remove ledger entry; submit with short days. Prompt: project status reason.

---

## 27. Constants and enumerations (verbatim)

Task statuses (`STATUS` key, label, group):
| key | label | group |
|---|---|---|
| new | New | ns (not started) |
| selected | Selected for development | ns |
| dev | In development | act |
| unit | Unit testing | act |
| fut | Functional testing | act |
| uat | UAT | act |
| feedback | Waiting for feedback | wait |
| hold | On hold | wait |
| blocked | Blocked | wait |
| done | Completed | done |

Complexity: 1 Low, 2 Medium, 3 High, 4 Very high.
Project types: product Product, service Service, saas SaaS, ams AMS. Commercial: fixed Fixed cost, tm Time & resources.
Project priorities: 1 EduReon, 2 HRMS delivery, 3 Client project, 4 Everything else.
Functions: delivery Delivery, sales Sales, ops Operations, mgmt Management.
Comment types: comment, bug, question, decision (+ system: status, sys).
Cost categories: Hosting and cloud; External vendor; Contractor or freelancer; Device and hardware procurement; Software licences and subscriptions; Third-party APIs (SMS, WhatsApp, payments); Domain and SSL; Data migration services; Security audit and testing; Travel and site visits; Training and documentation; Other.

Activity types (key, label, group, kind):
- General: mtg-int Internal meeting (meeting); mtg-client Client meeting (meeting); standup Daily stand-up (meeting); review Weekly review or Friday demo (meeting); oneone One-to-one (meeting); training Training and learning (learning); docs Documentation (work); kt Knowledge transfer (work); email Email and admin (work); travel Travel (travel).
- Breaks: lunch Lunch break; tea Tea break; brk Other break (all kind break).
- Delivery (work): codereview Code review; deploy Deployment and release; support Production support; estimate Estimation and planning; testing Testing (not tied to a task); research Technical research or proof of concept; env Environment and DevOps.
- Sales (work): s-call Prospect calls; s-demo Product demo; s-proposal Proposal writing; s-research Lead research; s-network Networking and BNI; s-content Marketing content; s-crm CRM updates.
- Operations: HR (work): o-recruit Recruitment and interviews; o-onboard Onboarding and exits; o-attend Attendance and leave management; o-queries Employee queries and grievances; o-engage Employee engagement and events; o-policy HR policies and documentation; o-appraisal Appraisal administration; o-training-coord Training coordination.
- Operations: Payroll and compliance (work): o-payroll Payroll processing; o-statutory PF, ESI and PT compliance; o-tds TDS and income tax; o-gst GST filing; o-roc ROC and company secretarial; o-audit Audit support; o-labour Labour law registers and returns.
- Operations: Finance and accounts (work): o-invoice Invoicing and billing; o-collect Collections follow-up; o-payables Vendor payments; o-books Bookkeeping and reconciliation; o-expense Expense claims; o-mis MIS and reporting; o-bank Banking and cash management; o-budget Budgeting and forecasting.
- Leave and holidays (leave): lv-casual Casual leave; lv-sick Sick leave; lv-earned Earned or vacation leave; lv-comp Compensatory off; lv-half Half-day leave; lv-lwp Leave without pay; lv-opthol Optional holiday.
- Operations: Admin and IT (work): o-procure Procurement and purchasing; o-assets Asset and inventory management; o-facility Office administration and facilities; o-it IT support and access management; o-vendor Vendor management; o-legal Contracts and legal documentation; o-travel Travel desk and logistics; o-iso ISO and quality documentation.

Activity type dropdown group order by function: ops → Ops HR, Ops Payroll, Ops Finance, Ops Admin, General, Breaks, Leave, Sales, Delivery; sales → Sales, General, Breaks, Leave, Delivery, Ops…; delivery → General, Breaks, Leave, Delivery, Sales, Ops….

Time-mix categories (`timeMix`): task with project → "Project tasks", task without → "Other work"; activity kind leave → Leave, break → Breaks, meeting → Meetings, learning → Training, travel → Travel, group starting "Operations" → Operations work, Sales → Sales work, else Other work.

Misc thresholds: EMPTY_DAYS 7; SALES_ACT_TARGET 15; approval SLA default 2 wd; MINH default 9; hoursPerDay default 6; default task estimate when missing 4h; utilisation horizon 10 wd; "next 30 days" = 22 wd for milestones; throughput window 20 wd; stale deal 14 days; win-rate window 180 days; DSO window 90 days; ops stats window 90 days; tasks-due-soon for client report ±10 wd.

---

## 28. Dead code / quirks / known bugs (fix in rebuild)

1. `renderLockout()` (manager lockout overlay) is defined but never called — decide whether to enforce.
2. `salesCompCard0()` and `ceoFinance()` are unused legacy versions.
3. `data-addtask` click handler exists but nothing renders `data-addtask` (replaced by `data-qa` quick-add).
4. `#aaRow` ("+ Add another row") and `#aaTask` are always hidden.
5. Insights milestone rows label `M{index+1}` instead of `M{ph.no}` — inconsistent after deletions.
6. `fMarginPct` computed as margin on cost (markup) but unused; the UI uses `projPct` (margin on price). Keep terminology straight: markup = profit/cost, margin = profit/price.
7. `wdi` ignores holidays; wdDiff/addWorkdays count holidays as working days while capacity doesn't. Consider holiday-aware working-day index.
8. Payroll counts pending days as neither paid nor deducted.
9. `hoursByDay` in approvals uses Mon–Sat (6 days); submit uses 7 days.
10. Timesheet approvals/KPIs only see the last 8 weeks subscribed (`tsw`).
11. Priority 1/2 labels ("EduReon", "HRMS delivery") are company-specific — make configurable for SaaS.
12. `isAdmin` = artifact editor; there is no real per-user auth or RBAC; role comes from device-chosen identity. The SaaS needs real auth + server-side RBAC and must hide CTC/finance at the API level.
13. Duplicate `[hidden]` CSS rules; `.admin-only.dep` odd selector.
14. Rules copy hard-codes "Managers approve within 2 working days" and "1:1 with Santosh" even though SLA is configurable.
15. `metricsDelivery` uses `weekDocs`/`prevDocs` only, so weeks other than current/previous show no EOD/demo data.

---

## 29. Rebuild notes (suggested React component map)

- `AppShell` (Header with RoleBar + WeekNav, Tabs, Toast, LockoutOverlay)
- State: server data via query hooks per collection; derived model via a pure `buildModel(data, calendar, today)` module (port sections 5–9 verbatim as pure TS functions with unit tests: `isWork, wdi, spanInfo, queueFinish, forecast, classifyRisk, cpm, msCalc, projKPI, metricsDelivery/Sales/Ops, apprKpi, calcCost, projFin, compOf, runPayroll, forecastAt/runSims, wkPerf, trendWord`).
- Dashboard: `CeoDashboard` (Overview/Projects/Sales/Finance/Operations), `PmDashboard`, `SalesDashboard`, `OpsDashboard` (Duties/People/Payroll/Money), `EmployeeDashboard`.
- Shared: `KpiGrid`, `TaskItem` (+ inline panels, `ThreadPanel`), `MilestoneTable`, `PortfolioTable`, `PeopleTable`, `HBars`, `VPairBars`, `TrendBars`, `Sparkline`, `Gantt`, `CostWidget`, `FinanceTable`, `ApprovalsCard`, `DealItem`.
- Pages: `ProjectsPage` (list + expandable `ProjectDetail`), `TasksPage` (`AssignTaskForm` with `DeliveryPreview`), `TimesheetPage` (`TimesheetGrid`, `EodForm`, `DemoForm`), `ScorecardPage`, `InsightsPage`, `ClientReportPage` (+ HTML export), `SettingsPage`, `RulesPage`.
- Keep Indian locale formatting (`en-IN`, ₹, lakh grouping), FY Apr–Mar, working-day semantics.
