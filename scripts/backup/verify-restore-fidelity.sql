\set ON_ERROR_STOP on

begin read only;

do $verify$
declare
  required_role text;
  table_name text;
  role_name text;
  privilege_name text;
  event_trigger_name text;
  application_trigger record;
  function_oid oid;
  function_is_security_definer boolean;
  public_execute boolean;
  public_table_privilege boolean;
  matching_count bigint;
begin
  foreach required_role in array array[
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
      raise exception 'Restore fidelity check failed: required managed role % is missing.', required_role;
    end if;
  end loop;

  foreach table_name in array array['businesses', 'products', 'orders', 'order_items']
  loop
    select count(*)
    into matching_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = table_name
      and c.relkind in ('r', 'p')
      and pg_get_userbyid(c.relowner) = 'postgres';

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: public.% is missing or does not have expected owner postgres.',
        table_name;
    end if;
  end loop;

  foreach table_name in array array[
    'businesses',
    'products',
    'orders',
    'order_items',
    'profiles',
    'admin_users',
    'admin_audit_logs',
    'business_order_counters',
    'public_order_rate_limit_buckets'
  ]
  loop
    select count(*)
    into matching_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = table_name
      and c.relkind in ('r', 'p')
      and c.relrowsecurity;

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: public.% is missing or RLS is disabled.', table_name;
    end if;
  end loop;

  -- Verify anon and authenticated roles cannot bypass RLS
  select count(*)
  into matching_count
  from pg_roles
  where rolname in ('anon', 'authenticated')
    and (rolsuper or rolbypassrls);

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: role anon or authenticated unexpectedly has SUPERUSER or BYPASSRLS privilege.';
  end if;

  foreach table_name in array array['orders', 'order_items']
  loop
    -- A. RLS MUST be enabled
    select count(*)
    into matching_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = table_name
      and c.relrowsecurity;

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: public.% is missing or RLS is disabled.', table_name;
    end if;

    -- C. No policies permitting anon/authenticated access (exact 0 policies for fail-closed RLS protection)
    select count(*)
    into matching_count
    from pg_policies
    where schemaname = 'public'
      and tablename = table_name;

    if matching_count <> 0 then
      raise exception 'Restore fidelity check failed: public.% has % unexpected policies (expected 0 for fail-closed RLS protection).',
        table_name, matching_count;
    end if;

    -- D. PUBLIC (grantee 0) must not have table privileges
    select exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      where n.nspname = 'public'
        and c.relname = table_name
        and acl.grantee = 0
    )
    into public_table_privilege;

    if public_table_privilege then
      raise exception 'Restore fidelity check failed: PUBLIC unexpectedly has table privileges on public.%.',
        table_name;
    end if;

    -- E. Table owner must not be anon or authenticated
    select count(*)
    into matching_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = table_name
      and pg_get_userbyid(c.relowner) in ('anon', 'authenticated');

    if matching_count > 0 then
      raise exception 'Restore fidelity check failed: public.% is owned by untrusted role anon or authenticated.', table_name;
    end if;

    -- F. service_role must retain required table privileges
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    loop
      if not has_table_privilege('service_role', format('public.%I', table_name), privilege_name) then
        raise exception 'Restore fidelity check failed: service_role lacks % on public.%.',
          privilege_name, table_name;
      end if;
    end loop;

  end loop;

  select count(*)
  into matching_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'orders_order_number_seq'
    and c.relkind = 'S'
    and pg_get_userbyid(c.relowner) = 'postgres';

  if matching_count <> 1 then
    raise exception 'Restore fidelity check failed: public.orders_order_number_seq is missing or does not have expected owner postgres.';
  end if;

  foreach role_name in array array['anon', 'authenticated']
  loop
    foreach privilege_name in array array['USAGE', 'SELECT', 'UPDATE']
    loop
      if has_sequence_privilege(role_name, 'public.orders_order_number_seq', privilege_name) then
        raise exception 'Restore fidelity check failed: role % unexpectedly has % on public.orders_order_number_seq.',
          role_name, privilege_name;
      end if;
    end loop;
  end loop;

  foreach privilege_name in array array['USAGE', 'SELECT']
  loop
    if not has_sequence_privilege('service_role', 'public.orders_order_number_seq', privilege_name) then
      raise exception 'Restore fidelity check failed: service_role lacks % on public.orders_order_number_seq.',
        privilege_name;
    end if;
  end loop;

  foreach function_oid in array array[
    to_regprocedure('public.create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)'),
    to_regprocedure('public.purge_expired_orders()')
  ]
  loop
    if function_oid is null then
      raise exception 'Restore fidelity check failed: a critical order function is missing.';
    end if;

    select count(*)
    into matching_count
    from pg_proc p
    where p.oid = function_oid
      and pg_get_userbyid(p.proowner) = 'postgres';

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: critical function % does not have expected owner postgres.',
        function_oid::regprocedure;
    end if;

    select exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = function_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    into public_execute;

    if public_execute
      or has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'Restore fidelity check failed: critical function % is executable by PUBLIC/anon/authenticated.',
        function_oid::regprocedure;
    end if;

    if not has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'Restore fidelity check failed: service_role cannot execute critical function %.',
        function_oid::regprocedure;
    end if;
  end loop;

  select p.prosecdef
  into function_is_security_definer
  from pg_proc p
  where p.oid = to_regprocedure('public.create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)');

  if function_is_security_definer then
    raise exception 'Restore fidelity check failed: create_order_with_items must remain SECURITY INVOKER.';
  end if;

  select p.prosecdef
  into function_is_security_definer
  from pg_proc p
  where p.oid = to_regprocedure('public.purge_expired_orders()');

  if not function_is_security_definer then
    raise exception 'Restore fidelity check failed: purge_expired_orders must remain SECURITY DEFINER.';
  end if;

  foreach event_trigger_name in array array[
    'issue_graphql_placeholder',
    'issue_pg_cron_access',
    'issue_pg_graphql_access',
    'issue_pg_net_access',
    'pgrst_ddl_watch',
    'pgrst_drop_watch'
  ]
  loop
    select count(*)
    into matching_count
    from pg_event_trigger e
    join pg_proc p on p.oid = e.evtfoid
    where e.evtname = event_trigger_name
      and e.evtenabled <> 'D'
      and pg_get_userbyid(e.evtowner) = 'supabase_admin'
      and pg_get_userbyid(p.proowner) = 'supabase_admin';

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: event trigger % is missing, disabled, or has an unexpected owner.',
        event_trigger_name;
    end if;
  end loop;

  for application_trigger in
    select *
    from (values
      ('public', 'businesses', 'businesses_set_updated_at'),
      ('public', 'orders', 'set_orders_updated_at'),
      ('public', 'products', 'products_set_updated_at'),
      ('public', 'profiles', 'profiles_set_updated_at'),
      ('storage', 'buckets', 'enforce_bucket_name_length_trigger'),
      ('storage', 'buckets', 'protect_buckets_delete'),
      ('storage', 'objects', 'protect_objects_delete'),
      ('storage', 'objects', 'update_objects_updated_at')
    ) as expected(schema_name, relation_name, trigger_name)
  loop
    select count(*)
    into matching_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and n.nspname = application_trigger.schema_name
      and c.relname = application_trigger.relation_name
      and t.tgname = application_trigger.trigger_name;

    if matching_count <> 1 then
      raise exception 'Restore fidelity check failed: application trigger %.%.% is missing or disabled.',
        application_trigger.schema_name,
        application_trigger.relation_name,
        application_trigger.trigger_name;
    end if;
  end loop;

  select count(*)
  into matching_count
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where (e.extname = 'pgcrypto' and n.nspname = 'extensions')
     or (e.extname = 'pg_cron' and n.nspname = 'pg_catalog');

  if matching_count <> 2 then
    raise exception 'Restore fidelity check failed: pgcrypto/pg_cron extensions are missing or in unexpected schemas.';
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'Restore fidelity check failed: cron.job is missing.';
  end if;

  select count(*)
  into matching_count
  from cron.job
  where jobname = 'purge_orders_after_180_days'
    and active
    and schedule = '17 * * * *'
    and btrim(command) = 'select public.purge_expired_orders();';

  if matching_count <> 1 then
    raise exception 'Restore fidelity check failed: purge_orders_after_180_days is missing, inactive, duplicated, or changed.';
  end if;

  select count(*)
  into matching_count
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not con.convalidated;

  if matching_count <> 0 then
    raise exception 'Restore fidelity check failed: % public constraints are not validated.', matching_count;
  end if;

  select count(*)
  into matching_count
  from pg_index idx
  join pg_class c on c.oid = idx.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_toast%'
    and (not idx.indisvalid or not idx.indisready or not idx.indislive);

  if matching_count <> 0 then
    raise exception 'Restore fidelity check failed: % non-system indexes are invalid, unready, or non-live.', matching_count;
  end if;

  -- Verify public schema default ACL contracts (restored from dump)
  -- 1. No global default ACLs
  select count(*)
  into matching_count
  from pg_default_acl d
  where d.defaclnamespace = 0 or d.defaclnamespace is null;

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: unexpected global default ACL entries detected (% rows).', matching_count;
  end if;

  -- 2. Only expected owners in public schema default ACLs: postgres and supabase_admin
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and pg_get_userbyid(d.defaclrole) not in ('postgres', 'supabase_admin');

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: unexpected default ACL owner in public schema (% rows).', matching_count;
  end if;

  -- 3. Only expected object types in public schema default ACLs: TABLE (r), SEQUENCE (S), FUNCTION (f)
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and d.defaclobjtype not in ('r', 'S', 'f');

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: unexpected default ACL object type in public schema (% rows).', matching_count;
  end if;

  -- 4. Exactly 6 restored default ACL entries in public schema
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public';

  if matching_count <> 6 then
    raise exception 'Restore fidelity check failed: expected exactly 6 restored default ACL entries in public schema, found %.', matching_count;
  end if;

  -- 5. Only expected grantees in public default ACL: postgres, anon, authenticated, service_role
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  left join pg_roles grantee_role on grantee_role.oid = acl.grantee
  where n.nspname = 'public'
    and coalesce(grantee_role.rolname, 'PUBLIC') not in ('postgres', 'anon', 'authenticated', 'service_role');

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: unexpected grantee in restored public default ACL (% rows).', matching_count;
  end if;

  -- 6. No grant options in public default ACL
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  where n.nspname = 'public'
    and acl.is_grantable;

  if matching_count > 0 then
    raise exception 'Restore fidelity check failed: unexpected grant option in restored public default ACL (% rows).', matching_count;
  end if;

  -- 7. Only expected privilege types per object type
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
    raise exception 'Restore fidelity check failed: unexpected privilege type in restored public default ACL (% rows).', matching_count;
  end if;

  -- 8. Exactly 96 exploded default privileges in public schema
  select count(*)
  into matching_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) acl
  where n.nspname = 'public';

  if matching_count <> 96 then
    raise exception 'Restore fidelity check failed: expected exactly 96 restored exploded default privileges in public, found %.', matching_count;
  end if;
end
$verify$;

\echo SERVICE_ROLE_ADDITIONAL_TABLE_PRIVILEGES=OBSERVED_ONLY

select
  object_name,
  privilege_name,
  has_table_privilege('service_role', format('public.%I', object_name), privilege_name) as observed
from (values ('orders'), ('order_items')) objects(object_name)
cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES'), ('MAINTAIN')) privileges(privilege_name)
order by object_name, privilege_name;

\echo SERVICE_ROLE_SEQUENCE_UPDATE=OBSERVED_ONLY

select
  'orders_order_number_seq' as object_name,
  'UPDATE' as privilege_name,
  has_sequence_privilege('service_role', 'public.orders_order_number_seq', 'UPDATE') as observed;

\echo PUBLIC_DEFAULT_PRIVILEGES=RESTORED_VERIFIED

select
  owner_role.rolname as owner_role,
  n.nspname as schema_name,
  case d.defaclobjtype
    when 'r' then 'TABLE'
    when 'S' then 'SEQUENCE'
    when 'f' then 'FUNCTION'
    when 'T' then 'TYPE'
    when 'n' then 'SCHEMA'
    else d.defaclobjtype::text
  end as object_type,
  coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_default_acl d
join pg_roles owner_role on owner_role.oid = d.defaclrole
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) acl
left join pg_roles grantee_role on grantee_role.oid = acl.grantee
where n.nspname = 'public'
  and owner_role.rolname in ('postgres', 'supabase_admin')
  and coalesce(grantee_role.rolname, 'PUBLIC') in (
    'PUBLIC', 'postgres', 'supabase_admin', 'anon', 'authenticated', 'service_role'
  )
order by owner_role, object_type, grantee, acl.privilege_type;

select
  c.oid::regclass::text as object_name,
  pg_get_userbyid(c.relowner) as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'businesses', 'products', 'orders', 'order_items', 'profiles',
    'admin_users', 'admin_audit_logs', 'business_order_counters',
    'public_order_rate_limit_buckets', 'orders_order_number_seq'
  )
order by object_name;

select
  p.oid::regprocedure::text as object_name,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_order_with_items', 'purge_expired_orders')
order by object_name;

select
  e.evtname as object_name,
  pg_get_userbyid(e.evtowner) as owner,
  pg_get_userbyid(p.proowner) as handler_owner
from pg_event_trigger e
join pg_proc p on p.oid = e.evtfoid
where e.evtname in (
  'issue_graphql_placeholder', 'issue_pg_cron_access',
  'issue_pg_graphql_access', 'issue_pg_net_access',
  'pgrst_ddl_watch', 'pgrst_drop_watch'
)
order by object_name;

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled,
  pn.nspname || '.' || p.proname as handler,
  pg_get_userbyid(c.relowner) as table_owner,
  pg_get_userbyid(p.proowner) as handler_owner
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and n.nspname in ('public', 'auth', 'storage')
order by n.nspname, c.relname, t.tgname;

commit;

\echo RESTORE_FIDELITY_VERIFICATION=PASS
