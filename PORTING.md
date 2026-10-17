# PORTING.md — how to port a TypeScript route module / engine to the Python API

You port `src/mock/routes/<name>.ts` (or an engine `src/mock/<name>.ts`) to `backend/app/...` with **byte-for-byte
behavioural parity**: same paths, methods, options, status codes, error codes and messages, field names, response
shapes, ordering, numbers and rounding, strings (formatted money and dates in messages), warnings and side effects
(rows written, notifications, activity log, emails, numbering). The TypeScript is the spec; when in doubt, read it
again — never guess a JavaScript behaviour, use `app/js.py`.

Reference ports to copy from (all parity-clean, see PORT_STATUS.md):
`app/routes/notifications.py`, `app/routes/billing.py`, `app/routes/admin.py`, `app/routes/auth.py`,
`app/engine/maker_checker.py` (engine + routes), `app/seeds/access.py` + `app/seeds/master.py` (provisioning).

---------------------------------------------------------------------------------------------------------------------

## 1. Where things go (naming is a contract between porters)

| TypeScript | Python | notes |
|---|---|---|
| `src/mock/routes/tasks.ts` | `app/routes/tasks.py` | snake_case file name: `docsV7.ts` → `docs_v7.py`, `workflowsV7.ts` → `workflows_v7.py` |
| `src/mock/analytics.ts` (engine) | `app/engine/analytics.py` | `approvalKpi` → `approval_kpi`, `docMarkup` → `doc_markup`, `makerChecker` → `maker_checker` |
| `src/mock/seeds/x.ts` (runtime provisioning only) | `app/seeds/x.py` | the demo seed itself is NOT ported (it is exported as JSON) |
| `src/domain/calendar.ts` | `app/domain/calendar.py` | all of `src/domain` is ported and golden-tested |
| exported function `canSeeTask` | `can_see_task` | snake_case of the TS export; same parameters in the same order |
| exported UPPER_CASE constant | `cat('mock/routes/tasks')['TASK_RELATION_LABEL']` | data constants come from the generated catalogue (§9) |

Cross-module imports follow the convention, so parallel porters can rely on names before the other module exists:
`from app.routes.tasks import can_see_task`. **Helpers already needed by ported code** (export them with exactly
these names): `app.routes.tasks.can_see_task(ctx, task)`, `app.routes.documents.visible_documents(ctx)`,
`app.routes.workflows_v7.can_view(ctx, instance)`, `app.routes.docs_v7.can_see_issued(ctx, doc)` (used by
`GET /search` in auth.py, which answers 500 for `q` ≥ 2 characters until those exist).

**people.py**: register `GET /auth/reset-info/:token` with `app.auth.overrides.reset_info_shared` (already ported,
the override wraps it — do not re-port it). Its 2FA routes use `app/engine/two_factor.py` (ported; note §6.7).

Every route module exposes `register(r)` and registers its routes **in the TS order, with the TS patterns and
options**. `app/router.py` loads modules in the TS `registerAll()` order; a module that does not exist yet is skipped
(its paths answer 404 ROUTE_NOT_FOUND). Matching is the mock's: first registered route with the method and segment
count whose literal segments match; `:params` are `decodeURIComponent`-decoded.

```python
def register(r: Router) -> None:
    r.get('/notifications', list_notifications)
    r.post('/notifications/:id/read', read_one, allow_view_as_write=True)   # opts: public, super_admin, allow_view_as_write
```

## 2. Handlers

A handler is a plain (sync) function `def handler(req: Req) -> Any`. `Req` mirrors the TS `Req`:

| TS | Python |
|---|---|
| `({ ctx, params, query, body, ifMatch, headers })` | `req.ctx`, `req.params['id']`, `req.query`, `req.body`, `req.if_match`, `req.headers` |
| `body.x` | `req.b('x')` — `UNDEF` when absent or when the body is not an object |
| `query.x` | `req.q('x')` — `UNDEF` when absent; values are strings (a repeated key is a list) |
| `ifMatch` | `req.if_match` — `UNDEF` when no header, else `Number(header)` (may be NaN) |
| `headers['Authorization']` | `req.headers.get('Authorization')` = `'Bearer <sha256 of the token>'` (sessions store hashes) |
| `return x` | `return x` — rows, dicts, lists; serialised like JSON.stringify (§7) |
| handler without `return` | `return UNDEF` (JS `undefined`: the envelope then has no `data` key). `return None` is JS `null`. |

The router already does what `dispatch()` does (401/403 super-admin/View-as 403/read-only 402/password-change 403,
file safety 422, If-Match parsing, warnings). Raise errors with `err(status, code, message, field?)` (`app.ctx`);
add warnings with `warn(ctx, code, message)`.

## 3. Ctx and the helpers of server.ts

`from app.ctx import ...` — 1:1 with `src/mock/server.ts`:

| TS | Python |
|---|---|
| `ctx.user`, `ctx.tenant` | `ctx.user`, `ctx.tenant` — always the CURRENT row of this request (like JS object identity); `ctx.user_id`, `ctx.tenant_id` |
| `ctx.role / realRole / viewAs / roleKey / perms / isSuper / today / warnings` | `ctx.role / real_role / view_as / role_key / perms (set) / is_super / today / warnings` |
| `has, hasAny, requireAction, requireAny, requireRole` | `has, has_any, require_action, require_any, require_role` |
| `roleDef, permissionsOf, usersWith, withAccess` | `role_def, permissions_of, users_with, with_access` |
| `rows(ctx, t)` | `rows(ctx, t)` — **read-only list** of the tenant's rows (§4) |
| `find(ctx, t, id, label)` | `find(ctx, t, id, label)` — 404 `"<label> not found."` |
| `insert(ctx, t, data)` | `insert(ctx, t, data)` → the new row (private: may be changed in place afterwards) |
| `update(ctx, t, id, patch, ifMatch)` | `update(ctx, t, id, patch, if_match)` → the NEW row (409 STALE, protected columns dropped, version+1) |
| `remove(ctx, t, id, ifMatch)`, `removeWhere(ctx, t, pred)` | `remove(...)`, `remove_where(ctx, t, pred)` |
| `nextNumber(ctx, scope, start)` | `next_number(ctx, scope, start)` |
| `notify(ctx, userId, type, title, body, link)` | `notify(ctx, user_id, type_, title, body, link=None)` |
| `logActivity(ctx, entity, id, action, summary)` | `log_activity(...)` |
| `calendarFor(ctx, userId?)` | `calendar_for(ctx, user_id=None)` → `CalendarCtx(settings, holidays, leave_dates)` |
| `userName(ctx, id)`, `canSeeSalaries`, `canSeeMargins`, `paginate(items, query)`, `uid()`, `nowISO()` | `user_name`, `can_see_salaries`, `can_see_margins`, `paginate`, `uid`, `now_iso` |
| `getDb()` | `get_db()` — `d.users` / `d['users']` read-only lists; `d.sessions = [...]` assigns (§4) |
| `persist()` | `persist()` (rarely needed: every write helper persists) |
| request memo `WeakMap<Ctx, …>` | `scope().memo` (a dict that lives for one request attempt) — **never** module-level mutable state |

## 4. Data access: the rules (the most important section)

Rows held by the per-process cache are **shared and READ-ONLY** (deep-frozen in dev/test: any in-place change raises
`FrozenError`). All writes go through helpers that **copy on write** into the request overlay; the flush diffs the
overlay against the snapshot and writes one transaction. Consequences:

1. **Never mutate a row or a list you read.** `rows(...)`, `get_db().x`, `find(...)`, `index(...)` return shared
   objects. Sort with `sorted(...)`/`js_sort(...)`, never `.sort()`; build new dicts with `{**row, 'x': 1}`.
2. **Writes return the new row; use it.** `t = update(...)`, `t = patch('tenants', t, {...})`. The old reference is
   unchanged (JS would see the change through identity — Python does not). Re-read lists (`rows(...)`) after a
   write if you need the new state.
3. **When the TS mutates a row in place and keeps using it** (direct assignments, `x.history.push(...)`, helper
   functions that change the row, several updates in a row), take a private copy first:
   `i = edit('wf_instances', find(ctx, 'wf_instances', id))` — then mutate `i` exactly like the TS
   (`i['status'] = 'cancelled'`, `i['history'].append({...})`, `enter_stage(ctx, i, ...)`). The copy sits in the
   overlay and is diffed at flush; `update()`/`patch()` on an owned row change it in place, so every reference to it
   stays valid (JS identity semantics). Rows returned by `insert()` are owned too.
4. Translations:

| TS | Python |
|---|---|
| `row.x = v; persist()` (one or few fields) | `row = patch(table, row, {'x': v})` |
| `Object.assign(row, {...}); row.version++` | `row = patch(table, row, {**changes, 'version': row['version'] + 1})` |
| `row.list.push(x)` / nested change | `row = edit(table, row); row['list'].append(x)` |
| `d.t = d.t.filter(pred)` | `get_db().t = [r for r in get_db().t if pred(r)]` (or `set_rows(t, …)`) |
| `d.t.push(row)` | `push(t, row)` |
| `arr.splice(arr.indexOf(r), 1)` | `scope().remove_row(t, r)` |
| `d.t.find(x => x.id === id)` | `find_by(t, 'id', id)` (indexed) or `next((x for x in get_db().t if …), None)` |
| `new Map(rows.map(r => [r.id, r]))` | `index(t, 'id')` (first row per key; cached per table version) — note: JS `new Map` keeps the LAST duplicate |
| `rows.filter(r => r.k === v)` in a loop | `group(t, 'k').get(v, [])` (rows in table order) |
| `JSON.parse(JSON.stringify(x))` / `structuredClone` | `thaw(x)` (`app.frozen`) |

5. `rows(ctx, t)` in tenant mode is the cached list itself (zero-copy); in super-admin (global) mode it is filtered.
   `get_db().users` also contains read-only "stub" users of OTHER tenants whose e-mail appears in a non-GET body
   (cross-tenant e-mail uniqueness checks, exactly like the reference) — `rows(ctx, 'users')` excludes them.
6. Platform (virtual) tables keep the mock shapes: `get_db().sessions` (`token` = SHA-256 hash, `user_id`,
   `tenant_id`, `created_at`), `reset_tokens` (`expires_at` epoch ms), `login_attempts` (`at` epoch ms). Assign a new
   list to change them. Passwords: `scope().password_matches(uid, plain)` for `d.passwords.find(...)?.password === x`,
   `scope().set_password(uid, plain)` for the filter+push pair, `scope().delete_password(uid)`.
7. Super-admin routes (`super_admin=True`) run in GLOBAL mode: `get_db()` holds every tenant's rows.

## 5. JavaScript semantics (`app/js.py` — golden-tested against Node)

* **undefined vs null**: `UNDEF` is JS `undefined` (falsy; dropped from JSON objects). Use `prop(row, 'x')` /
  `row.get('x', UNDEF)` when the TS reads an OPTIONAL field into a response (`{ x: row.x }` must omit `x` when the row
  has no `x`); `row.get('x')` (None) only for tests/comparisons. `a ?? b` → `coalesce(a, b)`; `a || b` → `js_or(a, b)`;
  `a && b` (value) → `js_and(a, b)`; `!!x` / `if (x)` → `js_truthy(x)` — **`[]` and `{}` are truthy in JS**; never
  write `if lst:` for a JS array check. `x == null` → `nullish(x)`.
* **numbers**: `Math.round` → `js_round` (half up, ints out); `x.toFixed(n)` → `to_fixed(x, n)`; `String(n)` and
  every number inside a message → `js_str(n)` (**f-strings print 8.0 / 1e-07 / True — always wrap numbers in
  js_str**; ints are safe); `Number(x)` → `js_number`; `parseInt/parseFloat` → `js_parse_int/js_parse_float`;
  `Number.isFinite/isInteger/isNaN` → `is_finite/is_integer/is_nan`; `a % b` → `js_mod` (sign of the dividend);
  `x / 0` → `js_div`; `Math.max(...[])` → `js_max([])` (-Infinity); Python `max()` raises on empty — use js_max/js_min.
  Python ints are exact and JS doubles are not: values above 2**53 only matter if the TS overflows (rare). Integral
  floats are serialised as integers automatically.
* **strings**: `trim` → `js_trim` (JS whitespace set); `split(sep, limit)` → `js_split`; `slice/substring` with
  negatives/NaN → `js_slice`; `padStart` → `pad_start`; `.length` of user text → `js_len` (UTF-16 units) where limits
  matter; regexes without the `u` flag treat astral characters as 2 units (`utf16_units`); `encodeURIComponent` →
  `encode_uri_component`; template literals with null/undefined → `js_template` / `js_str` ('null' / 'undefined').
  `arr.join(',')` with null items → `js_join`. `{...x}` of a non-object → `js_spread`.
* **regex**: JS `\d \w \b` are ASCII → `re.ASCII` (or `[0-9]`); JS `\s` is Unicode (Python's is close; do not add
  re.ASCII to patterns with `\s`); `/i` → `re.I`; `.test(s)` → `re.search(...)` (or `match` when anchored `^`);
  `s.replace(/x/g, y)` → `re.sub`; `s.replace('a', 'b')` (string) replaces the FIRST occurrence → `s.replace('a','b',1)`.
* **sorting**: JS sort is stable, like Python's. `a.x.localeCompare(b.x)` → key `locale_key(r['x'])` (exact ICU
  root collation, 100% on every seed string); `b.x.localeCompare(a.x)` → `sorted(..., key=…, reverse=True)` (still
  stable); `compareNumeric` → `numeric_key`; numeric comparators `a.n - b.n` → `key=lambda r: r['n']`; mixed or
  `||`-chained comparators → `js_sort(items, lambda a, b: locale_compare(a['n'], b['n']) or (b['v'] - a['v']))`.
  `arr.sort()` without comparator sorts as STRINGS → `js_sort(arr)`. `a < b` on strings → plain Python `<` (BMP).
* **dates**: `ctx.today` / `todayISO()` is the LOCAL date (TZ=Asia/Kolkata); `nowISO()` → `now_iso()` (ms, `Z`; inside a
  handler it is the REQUEST clock — the instant the request started, on both sides — so rows written by one request tie
  and keep insertion order in newest-first lists; never use `new Date().toISOString()` / `datetime.now()` in handlers);
  `Date.now()` → `now_ms()`; `new Date(s).getTime()` / `Date.parse(s)` → `date_parse(s)` (date-only = UTC midnight,
  date-time without zone = local); `new Date(ms).toISOString()` → `iso_from_ms`. All of `src/domain/calendar.ts` is in
  `app/domain/calendar.py` (`add_days`, `week_start`, `working_days_between`, `fmt_date`, …).
  `d.toLocaleDateString('en-IN', {...})` → `fmt_date_en_in(d, day='numeric', month='short', …)` (September is
  `Sept`); `toLocaleString('en-IN', {day, month:'short', hour, minute:'2-digit'})` → `fmt_datetime_en_in`.
* **money/number formatting**: `app/domain/money.py` (`fmt_money`, `fmt_money_compact`, `fmt_pct`, `fmt_num`,
  `fmt_hours`); `n.toLocaleString('en-IN')` / `Intl.NumberFormat('en-IN', {min,maxFractionDigits})` →
  `fmt_number_en_in(n, min_fd, max_fd)` (lakh grouping, ICU half-expand rounding — differs from toFixed!).
* **objects**: dict order = JS insertion order, except that JS lists integer-like keys first (ascending) — mirror it
  only where the frontend renders `Object.entries` of such a map. `delete o.k` → `o.pop('k', None)` on a private dict.
  `'k' in obj` works the same; `arr.includes(x)` → `x in arr`; `Set`/`Map` → set/dict (Map iteration = insertion order).

## 6. Engines and shared modules

1. `app/engine/maker_checker.py`: `register_applier(entity, fn)` at import time of your route module (like the TS),
   `propose(ctx, {...})`, `assert_base_version(cs, version)`, `pending_brief(...)`, `pending_change_for(...)`,
   `eligible_checkers(...)`, `REQUIRED_PERMISSION_OF`. Appliers receive `(ctx, cs)` and return
   `{'result': ..., 'result_id': ...}`; `cs['id'] == 'cs_direct'` for a direct (maker-checker off) apply.
2. `app/engine/email.py`: `send_email(ctx, key, {'email', 'user_id'}, vars, {'entity', 'id'})`, `render_template`,
   `template_for`, `LOGIN_URL`.
3. `app/engine/two_factor.py`: `two_factor_record`, `use_second_factor(rec, code=…, recovery_code=…)` → `(kind, rec)`,
   `touch(t, payload)` → new row. **They return the updated row** (the TS mutates `rec` in place) — use it.
4. `app/engine/secrets.py`: `seal_secret`, `open_secret` (AES-GCM box installed by the app).
5. `app/seeds/access.py`: `provision_tenant(scope, tenant, base)`; `app/seeds/master.py`: `provision_master`,
   `prefix_from_name`.
6. Engines still to port (`analytics`, `costing`, `performance`, `approval_kpi`, `workflows`, `docgen`,
   `doc_markup`): the module owner ports the whole TS file; other porters import by the convention name.
7. Module-level registries of the TS (route table, maker-checker appliers, hooks) are fine (immutable after import);
   anything per request goes in `scope().memo`.

## 7. Responses

The serializer is `JSON.stringify`: `UNDEF` object values are dropped, `UNDEF` array items become `null`, integral
floats print as integers, NaN/Infinity as `null`, frozen rows serialise like dicts. The envelope `{data, warnings}`,
`ETag` (data with a numeric `version`), `Cache-Control: no-store` are added by the gateway. Build response objects with
the same key order as the TS literal (parity compares sorted keys, but humans diff the JSON).

## 8. Golden tests (pure functions and engines)

For every exported function you port that has logic (formatting, rules, engines), compute vectors with the TS and
assert identical results:

1. `backend/tests/golden/gen/<module>.mjs` bundles the TS with `importTs()` from `backend/tools/_bundle.mjs` (alias
   `@` → `src`) and writes `backend/tests/golden/vectors/<module>.json` — run it with `TZ=Asia/Kolkata`.
2. Inputs: the REAL seed (`backend/var/seed.json` from `node backend/tools/export_seed.mjs`) plus edge cases. Engines
   are tested on the full seed (e.g. metrics for every project, costing for every project, stats for every user):
   build the inputs in the generator from the seed, record inputs AND outputs in the vector file, so the test does not
   depend on today's seed.
3. `backend/tests/golden/test_<module>.py` loads the vectors (`tests.golden.load_vectors`) and compares
   `js.prepare_json(python_result)` with the recorded value (see `test_domain.py`, `test_js.py`).
   Engines that need a request scope: run them inside `Scope(rt, 'fresh', None)` (see `test_provision.py`) or over
   HTTP (parity).

## 9. Catalogue constants

`node backend/tools/export_catalog.mjs` writes every exported UPPER_CASE JSON constant of the listed TS modules to
`backend/app/catalog/data/<module>.json` (plus the provisioning template and the DB key list). Read them with
`from app.catalog import cat` → `cat('mock/routes/billing')['PLANS']` (deep-frozen; a TS `Set` becomes a
`frozenset`). Constants holding functions are listed under `$skipped` — port those by hand. To export a new
module or a zero-argument factory, add it to `MODULES` / `FACTORIES` in the exporter, re-run it and commit the JSON;
`tests/unit/test_catalog_sync.py` fails when the JSON is stale.

## 10. Parity and suites

* **Parity for your module** (the in-process TS mock vs the Python API over HTTP, same seed):
  `backend/tools/parity.sh --modules <tag>[,<tag>…] --sweep` (tags = the OpenAPI tags in PORT_STATUS.md, e.g.
  `tasks`, `docs`, `makerChecker`). It resets `seereonos_py_parity` (create it once with
  `psql -U postgres -v dbname=seereonos_py_parity -f backend/tools/bootstrap.sql`), starts gunicorn on :8170 and runs
  `backend/tests/e2e/parity.ts`: the fixed reads/writes/errors of the reference harness, the module write scenarios
  in `moduleScenarios()` and (`--sweep`) every GET route of the module for 6 users. **Add your module's write
  scenarios to `moduleScenarios()`** (use `both()`; `bothSides()` when ids differ per side, e.g. a created record).
  Options: `--port`, `--db`, `--workers N` (multi-process coherence), `--keep`, `--no-reset`; `FREEZE_ROWS=false`
  runs the production (unfrozen) mode.
* **API suites over HTTP** (smokeB, smokeC, t2/*, w3/api_test, w7b/guide_api …, see scratchpad/be/integration_report.md):
  start the API with `DEMO_MODE=true` (e.g. `parity.sh --keep`) and run
  `backend/tools/run_suite.sh <suite.ts> http://localhost:8170 seereonos_py_parity` — it bundles the suite with
  `backend/tests/e2e/build-http.mjs` (the HTTP shim resets the demo data and reads PostgreSQL for `getDb()`).
* `python backend/tools/port_status.py --parity backend/var/parity-*.out` regenerates PORT_STATUS.md.

## 11. Checklist per module

- [ ] every route of the TS module registered, same order, patterns and options (`port_status.py` shows "options differ!")
- [ ] every exported helper ported with the snake_case name (others import it)
- [ ] no in-place mutation of read rows/lists (tests run frozen: `FrozenError` = bug); `edit()` where the TS mutates in place
- [ ] numbers in messages through `js_str`/`fmt_*`; `UNDEF` for optional fields; `js_truthy` for JS truthiness
- [ ] sorting with `locale_key` / `numeric_key` / `js_sort`; descending comparators with `reverse=True`
- [ ] golden tests for the module's pure functions / engine on the full seed
- [ ] `parity.sh --modules <tag> --sweep` green (only known, documented differences), write scenarios added
- [ ] relevant API suites over HTTP green (`run_suite.sh`)
- [ ] `ruff check app tests` clean, `pytest` green (`TZ=Asia/Kolkata python -m pytest`), PORT_STATUS.md regenerated

---------------------------------------------------------------------------------------------------------------------

## 12. Worked examples (real code)

### 12.1 A GET with filters and sorting — `GET /changes` (src/mock/makerChecker.ts)

```ts
r.get('/changes', ({ ctx, query }) => {
  const status = String(query.status ?? 'pending')
  const scope = String(query.scope ?? (canSeeAll(ctx) ? 'all' : 'mine'))
  let list = rows(ctx, 'change_sets')
  if (!canSeeAll(ctx) || scope === 'mine') list = list.filter((c) => c.maker_id === ctx.user.id)
  if (status !== 'all') list = list.filter((c) => (status === 'decided' ? c.status !== 'pending' : c.status === status))
  if (query.entity) list = list.filter((c) => c.entity === query.entity)
  let out = list.map((c) => view(ctx, c))
  if (scope === 'to_check') out = out.filter((c) => c.can_check)
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
})
```

```python
def list_changes(req: Req) -> Any:
    ctx = req.ctx
    status = js_str(coalesce(req.q('status'), 'pending'))              # String(x ?? d)
    scope_ = js_str(coalesce(req.q('scope'), 'all' if can_see_all(ctx) else 'mine'))
    lst = list(rows(ctx, 'change_sets'))                                # a copy: rows() is read-only
    if not can_see_all(ctx) or scope_ == 'mine':
        lst = [c for c in lst if c['maker_id'] == ctx.user_id]
    if status != 'all':
        lst = [c for c in lst if (c['status'] != 'pending' if status == 'decided' else c['status'] == status)]
    ent = req.q('entity')
    if js_truthy(ent):                                                   # if (query.entity) — JS truthiness
        lst = [c for c in lst if c['entity'] == ent]
    out = [view(ctx, c) for c in lst]
    if scope_ == 'to_check':
        out = [c for c in out if c['can_check']]
    # b.created_at.localeCompare(a.created_at): descending, stable -> key + reverse=True
    return sorted(out, key=lambda c: locale_key(c['created_at']), reverse=True)
```

### 12.2 A write with validation + update + notify + logActivity — `POST /changes/:id/reject`

```ts
r.post('/changes/:id/reject', ({ ctx, params, body }) => {
  const c = find(ctx, 'change_sets', params.id, 'Change')
  if (c.status !== 'pending') err(409, 'INVALID_STATE', `This change is already ${c.status}.`)
  if (c.maker_id === ctx.user.id) err(409, 'MAKER_CANNOT_CHECK', 'You proposed this change. Withdraw it instead.')
  requireAction(ctx, 'makerchecker.check', 'You can’t decide changes.')
  if (!ctx.perms.has(c.required_permission)) err(403, 'FORBIDDEN', `Deciding this needs “${PERMISSION_BY_KEY[c.required_permission]?.label ?? c.required_permission}”.`)
  const reason = String(body?.reason ?? '').trim()
  if (reason.length < 10) err(422, 'REASON_REQUIRED', 'Tell the maker why (at least 10 characters).', 'reason')
  const out = update(ctx, 'change_sets', c.id, { status: 'rejected', checker_id: ctx.user.id, decided_at: nowISO(), reason } as Partial<ChangeSet>)
  notify(ctx, c.maker_id, 'NTF-05', 'Change rejected', `${ctx.user.name} rejected: ${c.summary} — ${reason}`, '/changes')
  logActivity(ctx, 'change_set', c.id, 'rejected', `${ctx.user.name} rejected ${userName(ctx, c.maker_id)}’s change: ${c.summary} — ${reason}`)
  return view(ctx, out)
})
```

```python
def reject(req: Req) -> Any:
    ctx = req.ctx
    c = find(ctx, 'change_sets', req.params['id'], 'Change')
    if c['status'] != 'pending':
        err(409, 'INVALID_STATE', f'This change is already {js_str(c["status"])}.')
    if c['maker_id'] == ctx.user_id:
        err(409, 'MAKER_CANNOT_CHECK', 'You proposed this change. Withdraw it instead.')
    require_action(ctx, 'makerchecker.check', 'You can’t decide changes.')
    if c['required_permission'] not in ctx.perms:
        err(403, 'FORBIDDEN', f'Deciding this needs “{_perm_label(c["required_permission"])}”.')
    reason = js_trim(js_str(coalesce(prop(req.body, 'reason') if isinstance(req.body, dict) else UNDEF, '')))  # body?.reason
    if len(reason) < 10:
        err(422, 'REASON_REQUIRED', 'Tell the maker why (at least 10 characters).', 'reason')
    out = update(ctx, 'change_sets', c['id'], {'status': 'rejected', 'checker_id': ctx.user_id, 'decided_at': now_iso(), 'reason': reason})
    name = js_str(ctx.user.get('name', UNDEF))                         # `${ctx.user.name}` (undefined -> 'undefined')
    notify(ctx, c['maker_id'], 'NTF-05', 'Change rejected', f'{name} rejected: {c["summary"]} — {reason}', '/changes')
    log_activity(ctx, 'change_set', c['id'], 'rejected', f'{name} rejected {user_name(ctx, c["maker_id"])}’s change: {c["summary"]} — {reason}')
    return view(ctx, out)                                               # the NEW row returned by update()
```

An error raised AFTER writes (e.g. `err()` after `insert()`) keeps the writes, like the reference — the flush runs for
any `ApiError`; an unexpected exception (500) writes nothing.

### 12.3 A nested-array mutation — `POST /wf/instances/:id/cancel` (src/mock/routes/workflowsV7.ts)

```ts
const i = getVisible(ctx, params.id)
...
i.history.push({ stage_key: snap.stages[i.current_stage]?.key ?? '', by: ctx.user.id, action: 'cancelled', note: reason, at: nowISO() })
const was = i.current_assignee_id
i.status = 'cancelled'
i.current_assignee_id = null
i.stage_due_on = null
if (was && was !== ctx.user.id) notify(ctx, was, 'NTF-06', 'Workflow cancelled', `${i.title}: ${reason}`, `/workflows/run/${i.id}`)
...
save(ctx, i)          // the module's helper: updated_at / version++ / persist
return detailOf(ctx, i)
```

```python
i = edit('wf_instances', get_visible(ctx, req.params['id']))         # private deep copy, placed in the overlay
...
stages = snap['stages']
st = stages[i['current_stage']] if 0 <= i['current_stage'] < len(stages) else None
i['history'].append({'stage_key': coalesce(st.get('key', UNDEF) if st else UNDEF, ''), 'by': ctx.user_id,
                     'action': 'cancelled', 'note': reason, 'at': now_iso()})
was = i.get('current_assignee_id')
i['status'] = 'cancelled'
i['current_assignee_id'] = None
i['stage_due_on'] = None
if was and was != ctx.user_id:
    notify(ctx, was, 'NTF-06', 'Workflow cancelled', f'{js_str(i["title"])}: {reason}', f'/workflows/run/{i["id"]}')
...
save(ctx, i)          # ported helper; on an owned row patch()/update() work in place
return detail_of(ctx, i)
```

`edit()` makes the JS identity semantics hold: every helper that receives `i` (enter_stage, save, …) mutates the
same private dict, and the flush writes the final state once.
