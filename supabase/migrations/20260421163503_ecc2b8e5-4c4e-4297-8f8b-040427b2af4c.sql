
-- Fix function search path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tighten write policies: must be admin or vendedor
DROP POLICY "Authenticated manage customers" ON public.customers;
CREATE POLICY "Staff view customers" ON public.customers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff insert customers" ON public.customers FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff update customers" ON public.customers FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Admins delete customers" ON public.customers FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

DROP POLICY "Authenticated manage products" ON public.products;
CREATE POLICY "Staff view products" ON public.products FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff insert products" ON public.products FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff update products" ON public.products FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Admins delete products" ON public.products FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

DROP POLICY "Authenticated manage variants" ON public.product_variants;
CREATE POLICY "Staff view variants" ON public.product_variants FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff insert variants" ON public.product_variants FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff update variants" ON public.product_variants FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Admins delete variants" ON public.product_variants FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

DROP POLICY "Authenticated manage payable" ON public.accounts_payable;
CREATE POLICY "Staff view payable" ON public.accounts_payable FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff insert payable" ON public.accounts_payable FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff update payable" ON public.accounts_payable FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Admins delete payable" ON public.accounts_payable FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

DROP POLICY "Authenticated manage receivable" ON public.accounts_receivable;
CREATE POLICY "Staff view receivable" ON public.accounts_receivable FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff insert receivable" ON public.accounts_receivable FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Staff update receivable" ON public.accounts_receivable FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "Admins delete receivable" ON public.accounts_receivable FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));
