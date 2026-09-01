REVOKE EXECUTE ON FUNCTION public.increment_variant_stock(uuid, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.increment_variant_stock(uuid, integer) TO authenticated, service_role;