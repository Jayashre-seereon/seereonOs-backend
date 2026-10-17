-- Idempotent cluster bootstrap for the Python API (same roles and grants as server/db/bootstrap.sql), with the
-- database name as a variable. Run as a superuser:
--   psql -v ON_ERROR_STOP=1 -U postgres -v dbname=seereonos -f backend/tools/bootstrap.sql
--   (production: -v owner_password=... -v app_password=...)
-- Roles: seereon_owner owns the schema (migrations, seed, auth/platform work); seereon_app runs tenant statements
-- under RLS (NOBYPASSRLS, NOINHERIT); seereon_owner is a member of seereon_app (SET LOCAL ROLE in the flush).
\set ON_ERROR_STOP on
\if :{?dbname}
\else
  \set dbname seereonos
\endif
\if :{?owner_password}
\else
  \set owner_password seereon_owner
\endif
\if :{?app_password}
\else
  \set app_password seereon_app
\endif

SELECT 'CREATE ROLE seereon_owner LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seereon_owner') \gexec
SELECT 'CREATE ROLE seereon_app LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seereon_app') \gexec
ALTER ROLE seereon_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_password';
ALTER ROLE seereon_app   WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD :'app_password';
GRANT seereon_app TO seereon_owner;
ALTER ROLE seereon_app SET statement_timeout = '30s';
ALTER ROLE seereon_app SET idle_in_transaction_session_timeout = '60s';

SELECT format('CREATE DATABASE %I OWNER seereon_owner ENCODING ''UTF8'' TEMPLATE template0', :'dbname') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec
SELECT format('ALTER DATABASE %I OWNER TO seereon_owner', :'dbname') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO seereon_owner', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO seereon_app', :'dbname') \gexec
SELECT format('ALTER DATABASE %I SET timezone = ''UTC''', :'dbname') \gexec

\connect :dbname
ALTER SCHEMA public OWNER TO seereon_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO seereon_owner;
GRANT USAGE ON SCHEMA public TO seereon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE seereon_owner IN SCHEMA public GRANT USAGE ON SEQUENCES TO seereon_app;
