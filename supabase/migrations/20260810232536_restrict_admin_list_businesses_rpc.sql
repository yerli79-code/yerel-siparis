begin;

revoke execute on function public.admin_list_businesses() from public;
revoke execute on function public.admin_list_businesses() from anon;
revoke execute on function public.admin_list_businesses() from authenticated;

grant execute on function public.admin_list_businesses() to service_role;

commit;
