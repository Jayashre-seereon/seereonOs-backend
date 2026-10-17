# SeereonOS

Seereon's multi-tenant business operating system: delivery, time, approvals, payroll, sales, finance, operations,
reports and AI. This repository holds the **React frontend** (`frontend/`, desktop web app with dedicated phone layouts) and
the **API + database** (`backend/`: Python 3.11, FastAPI on gunicorn/uvicorn workers, PostgreSQL 16).

| | |
|---|---|
| API (Python) | [backend/README.md](backend/README.md) — layout, configuration, tests, deployment |
| Database | [backend/docs/database/README.md](backend/docs/database/README.md) (schema conventions, RLS, migrations), [ERD](backend/docs/database/ERD.md) |
| Security | [backend/SECURITY.md](backend/SECURITY.md) (ASVS L2 controls, threat model, deployment checklist) |
| API reference | `/api/docs` (Swagger UI) and `/api/v1/openapi.json` on a running API |

## Run it

**Everything in Docker** (PostgreSQL + the API, which also serves the built frontend):

```bash
cp backend/.env.example .env      # set POSTGRES_PASSWORD, SEEREON_*_PASSWORD, MFA_ENCRYPTION_KEY (openssl rand -base64 48)
docker compose up --build         # http://localhost:8000  (SEED_DEMO=true in .env for the demo data)
```

**Local development** (Node 22, Python 3.11, PostgreSQL 16):

```powershell
cd frontend
npm install                                   # .npmrc sets legacy-peer-deps
cd ..
pip install -r backend/requirements-dev.txt   # system Python: add --break-system-packages

# database (once, as a superuser), then schema + demo data
psql -U postgres -v dbname=seereonos -f backend/tools/bootstrap.sql
cd backend
$env:TZ='Asia/Kolkata'
python -m app.db.reset
cd ..

# API on :8000 serving the http build of the frontend
npm --prefix frontend run build:http          # frontend/dist talks to /api/v1 (VITE_API_MODE=http, browser routing)
cd backend
$env:TZ='Asia/Kolkata'
$env:DEMO_MODE='true'
$env:STATIC_DIR='../frontend/dist'
python -m uvicorn app.main:app --port 8000 --reload
#   or production-like: gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:8000

# frontend dev server against that API (hot reload), in a separate terminal from the repository root
cd frontend
$env:API_PROXY_TARGET='http://localhost:8000'
npm run dev -- --mode http
```

The frontend also runs without any backend, on the in-browser mock of the API (the executable specification). Run these from `frontend/`:

```bash
npm run dev            # http://localhost:5173 — mock API, browser routing
npm run build          # type-check + production SPA in dist/ (mock mode)
npm run build:preview  # one self-contained HTML file in dist-preview/ (hash routing + mock API)
npm run typecheck
```

One-command integration stack (fresh `seereonos` DB, http build, 2 gunicorn workers on :8000, `DEMO_MODE=true`):
`backend/tests/e2e/stack.sh` (`--stop` to stop; see `backend/README.md` for the parity harness and the e2e suites).

Demo logins use the password `Seereon@123`:

| Who | Email | Sees |
|---|---|---|
| CEO (admin) | santosh@seereon.co.in | everything, View as |
| Project manager (margins grant) | subhankar@seereon.co.in | delivery, team, approvals |
| Employee | hritesh@ · bijaya@ · jagannath@ · jayashree@ · pragyasmita@seereon.co.in | own work and time |
| Sales | baishali@ · subham@seereon.co.in | pipeline, own performance and pay |
| Ops (salaries grant) | priya@seereon.co.in | operations, leave, ledger (read) |
| Second tenant (admin, trial) | ananya@kalingasoft.in | Kalinga Softworks only |
| Platform super admin | platform@seereon.co.in | tenant list, trials, suspensions |

In mock mode the demo data lives in the browser (localStorage); **Sign-in → Reset demo data** restores it. Against the API
(`DEMO_MODE=true`) the same button calls `POST /api/v1/demo/reset`, which reloads the demo data in PostgreSQL.

## Architecture

```
frontend/src/
  app/        shell (sidebar, top bar, phone tab bar, command palette ⌘K), routes, auth layout
  ui/         design system: Button, forms, Dialog/Sheet, DataTable (table on desktop, cards on phone), charts, badges…
  theme/      theme engine: presets + custom colours → CSS variables (light and dark), per tenant
  domain/     calendar (working days, FY, periods), money formatting, costing rules, permission matrix, status labels
  types/      entity + report contracts (snake_case, money in paise), same as the database schema (backend/migrations)
  api/        typed client functions + TanStack Query hooks per module
  mock/       in-browser mock of /api/v1: tenant isolation, RBAC, If-Match versions, rule/error codes, seed data
  reports/    report engine, datasets, AI planner, corporate PDF/Excel/CSV export
  modules/    screens: auth, admin, projects, work, sales, finance, insights, reports
  assets/     official Seereon logo (gold on transparent); the emblem must never be redrawn
```

- **Real backend:** `VITE_API_MODE=http` (`npm run build:http`, `frontend/.env.http`) with `VITE_API_BASE` (default `/api/v1`). Every screen talks through `frontend/src/api/http.ts`, which sends `Authorization: Bearer`, `If-Match` and `X-View-As`. It expects `{data, warnings}` or plain JSON, and errors shaped `{error:{code,message,field}}`. The mock routes in `frontend/src/mock/routes/*.ts` are the executable specification for each endpoint; the Python API in `backend/app/routes/*.py` is their port with byte-for-byte parity (same paths, payloads, rule codes, messages and permission checks), proven by the parity harness `backend/tests/e2e/parity.ts`.
- **Money** is integer paise end to end. The UI only formats it. All calculations (cost per hour, margins, payroll, compensation, revenue, forecasts) live on the server side. In the mock they are in `frontend/src/mock/analytics.ts` and the route files, and in the API they are `backend/app/engine/*.py` and `backend/app/routes/*.py` (golden-tested against the TypeScript).
- **Multi-tenancy:** every row carries `tenant_id`. Reads go through `rows()`/`find()`, so a cross-tenant id returns 404. Query cache keys are prefixed with tenant + role, so switching tenant or View as never shows another scope's data.
- **Permissions:** `frontend/src/domain/permissions.ts` is the matrix from the Technical Design. The UI hides actions with `useCan()` and the API enforces the same rules. View as is read-only, and read-only tenants get 402 except on billing.
- **Theme:** Settings → Appearance. Admins choose a preset or custom brand colours, radius, density, font, sidebar style and default mode for the whole workspace. Each person can override light/dark for themselves. Charts use a colour-blind-validated categorical palette; a single series uses the brand colour.

## Access, master data and controls (v4)
- **One login, screens by permission.** Every capability is a permission key (`frontend/src/domain/permissionCatalog.ts`, 70+ keys in 9 modules). Roles are tenant data that bundle keys; nine default roles ship with every workspace (Administrator, CEO, CTO, Project Manager, HR Manager, HR Executive, Sales Manager, Sales Executive, Employee). Each person can get extra permissions on top of their role, or have some removed. Navigation, routes, buttons, row actions and the data each API returns all follow the effective permissions; the role's persona only picks the home dashboard.
- **Organisation setup (`/setup`).** Setup checklist; organisation profile (legal, tax IDs with format checks, addresses, employee numbering, bank); locations; departments (tree, heads, cost centres); designations (default role); grades and CTC bands; cost centres; shifts with assignment; roles & permission matrix (with compare); maker-checker; approval workflows; email templates and the sent log.
- **Onboarding flow.** Administrator fills master data → reviews roles → **Create employee** (`/people/new`: job, role, manager, shift, optional extra permissions and CTC) → employee code and temporary password are generated and the welcome email is written to the outbox → the employee signs in, must set a new password (`/welcome/password`) and lands on their own portal.
- **Maker-checker.** Sensitive changes (roles, user access, salaries, payroll finalisation, vendor bank/tax details, workflows, org profile, company settings, and optionally employees, master data, shifts, budgets) are proposed by one person and applied only after a different person with “Check changes” and the same permission approves them at `/changes` (also in the approvals inbox). One pending change per record; stale proposals fail; rejections need a reason.
- **Approval workflows.** Leave, expenses, purchase orders, vendor bills, timesheets and task review route through configurable step chains (reporting manager, skip level, project PM, department head, role, person; amount thresholds; SLAs; escalation). Defaults reproduce the v3 behaviour; requests keep the chain they were submitted with.

## v7 — menus, cost calculator, workflows, documents, GST invoices

- **Sidebar**: two-level menus (collapsible groups, submenus, phone More sheet, Ctrl/Cmd+K). Project areas open from the sidebar at `/delivery/*` (Milestones & billing, WBS, Schedule, Change requests, Resource allocation, Costing & margin, Project documents, Client view, Import WBS) with cross-project overviews and a project picker.
- **Project cost calculator** (`/projects/cost-calculator`): saved estimates for prospective projects, roles with assumed CTC, scenarios and compare, internal/client PDFs, convert to project. Salary-safe: without `cost_rates.view`, named people are not allowed and costing on estimates with named people is hidden.
- **Tasks**: employees see their own / covering / reviewer tasks; `tasks.view_all` sees all with an employee filter. One Create task form everywhere (`/tasks/new`).
- **Workflows** (`/workflows`, `/workflows/designer`): designer with stages, assignee rules, per-stage reviewer fields and field visibility, SLA + escalation, completion actions (letter, email, CTC change via maker-checker, notify, task). Seeded: Annual appraisal (self > manager/TL > unit head > HR > finance > letter), confirmation, onboarding, exit, promotion, document approval.
- **Documents hub** (`/documents`): Templates, Issued documents, Policies, Employee documents, Project documents, My documents. Payslips issue on payroll finalise; joining letter on create employee.
- **GST invoices** (`/finance/invoices`): editor per project/milestone, CGST+SGST vs IGST, HSN/SAC, bank + IFSC, amount in words, PDF, payments with TDS, credit notes. Revenue is booked at taxable value; GST is kept separate.
- Feature Guide regression: `docs/feature-guide-v7-regression.md` (118 items, new menu path for each).

## Feature Guide parity (v5)
Every feature in the Seereon Delivery Board Feature Guide (`docs/Seereon-Delivery-Board-Feature-Guide.pdf`, checklist `docs/feature-guide-checklist.md`) is implemented on top of v3/v4. Cross-reference workbook: `docs/SeereonOS-Feature-Guide-Cross-Reference.xlsx` (118 guide features → where they are built, plus every additional feature).
- **Projects:** status chips, inline status with reasons, health, forecast end, inline expand; Create project with **auto milestone setup** ("name | amount" per line → M1..Mn) and the **project cost calculator** (resources by milestone with alloc %, working days, man-days, cost/day; additional costs, maintenance, contingency, markup ⇄ price), documents at creation.
- **Milestones & WBS:** automatic deadlines from the last task, baselines and slips, billing state, auto-cleanup, full WBS with float/critical/forecast; Gantt, critical path text, breach-risk list with actions; change requests with CR-n, scope growth and "add its tasks to the WBS".
- **Costing & margins:** planned / projected / actual, margin vs markup, what moved the margin, milestone variance, allocated vs logged, planned costing; portfolio profit margins (`/finance/margins`); cost loading.
- **Tasks:** 10 delivery stages with progress, tags (Bug…), very-high complexity, estimate hints, covering backups, all-tasks page.
- **Time & people:** Mon–Sat timesheet tied to the header week, quick rows, Friday demo, approvals KPI strip and team 4-week grid with unlock, payroll with pending vs not approved, leave taken by type, team & hours roster, delegation scope.
- **Dashboards:** header week switcher, five dashboards with CEO sub-tabs, delivery control and task pipeline, resource load in hours, operations duties, predictions, estimation accuracy, scorecard with early warning, client view hub, Rules & KPI definitions (`/rules`).
- **Sales & finance:** lead form, 12 pipeline KPIs, funnel, 30-day activity log, sales cost vs deals closed (month/quarter/year, editable variable/target), salesperson performance, monthly P&L (payroll vs other costs), ledger.

## AI (reports from plain English)

The model never produces figures. It turns a question into a `ReportSpec` (dataset, measures, dimensions, filters, period, chart), or calls data tools. The report engine then computes every number from live data, with the asker's permissions.

- Inside claude.ai (the hosted preview), the Claude `sample` capability does the planning and tool calls.
- In the product, `POST /ai/plan` and `POST /ai/answer` are the backend contract. The mock ships a rule-based planner that handles about 40 common questions, so the feature works without an LLM. The FastAPI version should call Claude with the same datasets, tools and validation.

## Exports

`frontend/src/reports/export.ts` → `exportTable(table, 'pdf' | 'xlsx' | 'csv')`:

- **PDF:** branded A4 with logo header band, KPI boxes, chart image, zebra table with totals, page numbers and a confidentiality footer.
- **Excel:** summary sheet plus a data sheet with brand header, frozen panes, filters, ₹ and % formats and SUM totals.

Every list, report, payroll run, ledger and invoice uses it.

## Where each screen lives (Technical Design UI ids)

| Screens | Folder |
|---|---|
| UI-01..04, 26 auth/legal | `modules/auth` |
| UI-05..07, 17, 23..25, 38, 41 people, settings, cost rates, billing, super admin, onboarding, delegations, 2FA | `modules/admin` |
| UI-08..11, 18..20, 34, 35, 39 projects, WBS, import, allocation, margin, invoicing, change requests, openings, Gantt | `modules/projects` |
| UI-12..16, 22, 37, 40 my tasks, task drawer, notifications, timesheet, approvals, payroll, team, daily update, leave | `modules/work` |
| UI-27..31, 33 pipeline, deals, performance, compensation, ledger, invoices, P&L, operations | `modules/sales`, `modules/finance` |
| UI-21, 32, 36 role dashboards, insights, scorecard, reports, report builder, AI | `modules/insights`, `modules/reports` |

## Not wired to real services yet

Email delivery, Razorpay, file storage and scheduled jobs (weekly lock, Friday nudge, SLA digest, stale deals, scheduled report emails) are simulated in the mock. Their endpoints and notifications are in place for the backend to implement. 2FA accepts any 6-digit code in the mock.

See `CONVENTIONS.md` for the build rules and `specs/` for the BRD/FSD, technical design and prototype reference.
