-- Client-side direct writes to public.businesses are disabled.
-- Business profile and admin operations are handled by server routes using service role.

begin;

drop policy if exists "Owners can update own business" on public.businesses;
drop policy if exists "Owners can insert own business" on public.businesses;
drop policy if exists "Owners can delete own business" on public.businesses;
drop policy if exists "Admins can insert businesses" on public.businesses;

revoke insert on public.businesses from anon;
revoke update on public.businesses from anon;
revoke delete on public.businesses from anon;

revoke insert on public.businesses from authenticated;
revoke update on public.businesses from authenticated;
revoke delete on public.businesses from authenticated;

commit;
