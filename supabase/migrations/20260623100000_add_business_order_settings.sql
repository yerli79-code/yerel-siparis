begin;

alter table public.businesses
add column if not exists minimum_order_amount numeric;

alter table public.businesses
add column if not exists preparation_time_minutes integer;

alter table public.businesses
add column if not exists is_open boolean not null default true;

alter table public.businesses
add column if not exists order_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_minimum_order_amount_non_negative'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
    add constraint businesses_minimum_order_amount_non_negative
    check (
      minimum_order_amount is null
      or minimum_order_amount >= 0
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_preparation_time_minutes_range'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
    add constraint businesses_preparation_time_minutes_range
    check (
      preparation_time_minutes is null
      or preparation_time_minutes between 1 and 720
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_order_note_max_length'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
    add constraint businesses_order_note_max_length
    check (
      order_note is null
      or char_length(order_note) <= 300
    );
  end if;
end $$;

commit;
