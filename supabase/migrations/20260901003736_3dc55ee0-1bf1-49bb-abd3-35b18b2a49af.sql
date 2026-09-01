CREATE OR REPLACE FUNCTION public.increment_variant_stock(variant_id uuid, qty integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE new_qty int;
BEGIN
  UPDATE public.product_variants
     SET quantity = GREATEST(0, quantity + qty)
   WHERE id = variant_id
  RETURNING quantity INTO new_qty;
  RETURN new_qty;
END;
$function$;