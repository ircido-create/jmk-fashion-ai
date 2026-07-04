CREATE OR REPLACE FUNCTION public.decrement_variant_stock(variant_id uuid, qty int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_qty int;
BEGIN
  UPDATE public.product_variants
     SET quantity = GREATEST(0, quantity - qty)
   WHERE id = variant_id
  RETURNING quantity INTO new_qty;
  RETURN new_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_variant_stock(uuid, int) TO authenticated, service_role;

-- Consolidar variações duplicadas do VESTIDO LISTRADO TRICO (42/UNICO)
UPDATE public.product_variants
   SET quantity = 3
 WHERE id = 'b9c23843-31c9-4342-b737-6dd9a9c17752';

DELETE FROM public.product_variants
 WHERE id IN (
   '916687a2-7668-474c-9228-39d78a35d596',
   'b3e2a59b-dc9b-4229-9c94-a39771b88118'
 );