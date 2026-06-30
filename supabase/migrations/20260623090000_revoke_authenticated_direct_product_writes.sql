begin;

revoke insert on table public.products from anon;
revoke update on table public.products from anon;
revoke delete on table public.products from anon;

revoke insert on table public.products from authenticated;
revoke update on table public.products from authenticated;
revoke delete on table public.products from authenticated;

commit;
