
-- 1) Mesclar Francieli duplicada: mover referências do cadastro vazio para o cadastro com dívidas
DO $$
DECLARE
  old_id uuid := '4262347a-6aec-47a9-bc98-abc6ecfa051a';
  new_id uuid := 'fb979fd5-a93d-4ab8-9238-adccc19e5591';
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = old_id)
     AND EXISTS (SELECT 1 FROM public.customers WHERE id = new_id) THEN
    UPDATE public.accounts_receivable SET customer_id = new_id WHERE customer_id = old_id;
    UPDATE public.sales SET customer_id = new_id WHERE customer_id = old_id;
    UPDATE public.pre_sales SET customer_id = new_id WHERE customer_id = old_id;
    UPDATE public.payment_proofs SET customer_id = new_id WHERE customer_id = old_id;
    UPDATE public.whatsapp_conversations SET customer_id = new_id WHERE customer_id = old_id;
    UPDATE public.dunning_logs SET customer_id = new_id WHERE customer_id = old_id;
    DELETE FROM public.customers WHERE id = old_id;
  END IF;
END $$;

-- 2) Normalizar telefones (somente dígitos) em toda a tabela de clientes
UPDATE public.customers
   SET phone = regexp_replace(phone, '\D', '', 'g')
 WHERE phone IS NOT NULL
   AND phone ~ '\D';
