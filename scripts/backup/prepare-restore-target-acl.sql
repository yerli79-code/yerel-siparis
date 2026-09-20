\set ON_ERROR_STOP on

begin;

do $prepare_target$
declare
  required_role text;
  matching_count bigint;
begin
  -- 1. Fail-closed guards: Must be postgres DB, local socket (not production network)
  if current_database() <> 'postgres' then
    raise exception 'Target ACL preparation check failed: database must be postgres, found %.', current_database();
  end if;

  if inet_server_addr() is not null then
    raise exception 'Target ACL preparation check failed: must only be executed on local disposable restore target via unix socket (inet_server_addr is %).',
      inet_server_addr();
  end if;

  -- 2. Validate public schema exists
  if to_regnamespace('public') is null then
    raise exception 'Target ACL preparation check failed: public schema is missing.';
  end if;

  -- 3. Validate expected managed roles exist
  foreach required_role in array array[
    'postgres',
    'supabase_admin',
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin'
  ]
  loop
    if to_regrole(required_role) is null then
      raise exception 'Target ACL preparation check failed: required managed role % is missing.', required_role;
    end if;
  end loop;

  -- 4. Check for unexpected global default ACLs (defaclnamespace = 0 or null)
  select count(*)
  into matching_count
  from pg_default_acl d
  where d.defaclnamespace = 0 or d.defaclnamespace is null;

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected global default ACL entries detected (% rows).', matching_count;
  end if;

  -- 5. Validate public schema default ACL owners: only postgres and supabase_admin
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and pg_get_userbyid(d.defaclrole) not in ('postgres', 'supabase_admin');

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected default ACL owner in public schema (% rows).', matching_count;
  end if;

  -- 6. Validate public schema default ACL object types: only TABLE (r), SEQUENCE (S), FUNCTION (f)
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and d.defaclobjtype not in ('r', 'S', 'f');

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected default ACL object type in public schema (% rows).', matching_count;
  end if;

  -- 7. Validate exact count of default ACL entries in public schema: exactly 6 rows
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public';

  if matching_count <> 6 then
    raise exception 'Target ACL preparation check failed: expected exactly 6 default ACL entries in public schema, found %.', matching_count;
  end if;

  -- 8. Validate grantees in public schema default ACL: only postgres, anon, authenticated, service_role
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  left join pg_roles grantee_role on grantee_role.oid = acl.grantee
  where n.nspname = 'public'
    and coalesce(grantee_role.rolname, 'PUBLIC') not in ('postgres', 'anon', 'authenticated', 'service_role');

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected grantee in public default ACL (% rows).', matching_count;
  end if;

  -- 9. Validate no grant options (is_grantable must be false)
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  where n.nspname = 'public'
    and acl.is_grantable;

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected grant option in public default ACL (% rows).', matching_count;
  end if;

  -- 10. Validate exact privilege types allowed per object type
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  where n.nspname = 'public'
    and not (
      (d.defaclobjtype = 'r' and acl.privilege_type in ('DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE')) or
      (d.defaclobjtype = 'S' and acl.privilege_type in ('SELECT', 'UPDATE', 'USAGE')) or
      (d.defaclobjtype = 'f' and acl.privilege_type in ('EXECUTE'))
    );

  if matching_count > 0 then
    raise exception 'Target ACL preparation check failed: unexpected privilege type in public default ACL (% rows).', matching_count;
  end if;

  -- 11. Validate exact exploded privileges count in public schema: exactly 96
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  where n.nspname = 'public';

  if matching_count <> 96 then
    raise exception 'Target ACL preparation check failed: expected exactly 96 exploded default privileges in public, found %.', matching_count;
  end if;

end
$prepare_target$;

-- 12. Normalize public default ACLs to built-in PostgreSQL baseline
-- Removing explicit grants drops the pg_default_acl rows completely,
-- returning public schema to clean PostgreSQL initial state.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role, postgres;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role, postgres;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role, postgres;

alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role, postgres;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role, postgres;
alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role, postgres;

-- 13. Fail-closed post-normalization verification:
-- pg_default_acl rows in public schema must now be exactly 0
do $verify_cleanup$
declare
  remaining_count bigint;
begin
  select count(*)
  into remaining_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public';

  if remaining_count <> 0 then
    raise exception 'Target ACL preparation check failed: expected 0 default ACL rows in public after normalization, found %.', remaining_count;
  end if;
end
$verify_cleanup$;

commit;

\echo PREPARE_RESTORE_TARGET_ACL=PASS
