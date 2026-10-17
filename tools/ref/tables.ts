// Frozen copy of the Node reference's table catalogue (server/src/uow/tables.ts, removed with the Node server): the
// mock DB keys in the mock seed's key order. export_catalog.mjs writes it to app/catalog/data/tables.json (DB_KEYS);
// the compile-time check below still proves the list covers every key of the mock `DB`.
// Table catalogue of the runtime: the mock DB keys (in the mock seed's key order, so whole-DB iteration such as the
// tenant export yields the same order) and which of them are "virtual" platform tables backed by security tables.
import type { DB } from '@/mock/server'

/** Keys of the mock `DB` in the order the mock seed creates them (Object.keys order of the in-memory DB). */
export const DB_KEYS = [
  'tenants', 'users', 'passwords', 'login_attempts', 'sessions', 'invites', 'reset_tokens', 'subscriptions',
  'billing_invoices', 'holidays', 'delegations', 'projects', 'project_status_history', 'milestones', 'tasks',
  'task_dependencies', 'comments', 'notifications', 'timesheet_weeks', 'timesheet_entries', 'leave', 'daily_updates',
  'cost_rates', 'allocations', 'files', 'invoices', 'payments', 'payroll_runs', 'payroll_lines', 'ledger_entries',
  'deals', 'deal_activities', 'deal_stage_history', 'change_requests', 'openings', 'ops_items', 'activity_log',
  'saved_reports', 'data_exports', 'number_sequences', 'admin_audit',
  'roles', 'change_sets', 'approval_workflows', 'locations', 'departments', 'designations', 'grades', 'cost_centres', 'shifts', 'email_templates', 'email_outbox',
  'cost_estimates', 'wf_templates', 'wf_instances', 'doc_templates', 'issued_documents', 'employee_documents',
  'task_reviews', 'documents', 'document_versions', 'document_acks', 'document_views', 'leave_requests', 'leave_policies',
  'appraisal_cycles', 'appraisals', 'goals', 'feedback', 'candidates', 'interviews', 'lifecycle_checklists', 'assets',
  'expense_claims', 'vendors', 'purchase_orders', 'vendor_bills', 'budgets', 'clients', 'contracts', 'revenue_leakage',
  'objectives', 'key_results', 'pending_tokens',
] as const satisfies readonly (keyof DB)[]

// compile-time check that the list covers every DB key
type Missing = Exclude<keyof DB, (typeof DB_KEYS)[number]>
const _covers: Missing extends never ? true : Missing = true
void _covers

export type DbKey = (typeof DB_KEYS)[number]

/** Mock tables whose rows live in platform security tables with a different shape (see virtual.ts). */
export const VIRTUAL_TABLES = ['passwords', 'sessions', 'reset_tokens', 'login_attempts'] as const
export type VirtualTable = (typeof VIRTUAL_TABLES)[number]
export const isVirtual = (t: string): t is VirtualTable => (VIRTUAL_TABLES as readonly string[]).includes(t)

/** Tables every authenticated request needs to build its Ctx (user, tenant, role permissions). */
export const CTX_TABLES: DbKey[] = ['tenants', 'users', 'roles']

/** Tables a platform (super-admin) request may touch; they are loaded across all tenants. */
export const GLOBAL_TABLES: DbKey[] = ['tenants', 'users', 'subscriptions', 'admin_audit', 'roles', 'sessions']
