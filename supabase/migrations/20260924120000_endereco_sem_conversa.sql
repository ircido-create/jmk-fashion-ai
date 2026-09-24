-- Endereço de cliente não pode ser trecho de conversa (24/09/2026).
--
-- A Mônica grava a resposta da cliente como endereço sempre que acabou de
-- perguntar o endereço (qualquer texto com 10+ caracteres — monica-core.ts,
-- autoUpdateCustomer). Resultado: de 170 endereços, ~141 eram mensagens
-- ("Oi Mônica, paz e Deus… não tô devendo…"), mensagens de fornecedor,
-- catálogos e telefones soltos.
--
-- 1) Cópia de segurança dos endereços removidos (customers_address_backup).
-- 2) Regra no banco: gravação SEM usuário logado (Mônica/edge functions, com
--    service role) de um endereço com cara de conversa é ignorada e o
--    endereço anterior é mantido. O que a equipe digita na tela não passa por
--    essa regra. Evita republicar a edge function da Mônica.
-- A limpeza dos dados existentes foi feita à parte, com a lista conferida.

CREATE TABLE IF NOT EXISTS public.customers_address_backup (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL,
  customer_name text,
  address text NOT NULL,
  reason text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customers_address_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view address backup" ON public.customers_address_backup;
CREATE POLICY "Admins view address backup" ON public.customers_address_backup
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.address_looks_like_message(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p IS NOT NULL AND (
       p ~ '\?'
    OR p ~* 'https?://'
    OR length(p) > 200
    OR p !~ '\d'                                   -- endereço tem número
    OR p ~ '^[\d\s()+.-]+$'                        -- telefone solto
    OR p ~* '(r\$|\d+,\d{2}\M|\mreais\M)'          -- valor em dinheiro
    OR (array_length(regexp_split_to_array(trim(p), '\s+'), 1) > 12
        AND p !~* '\m(rua|r\.|av|avenida|travessa|estrada|alameda|rodovia|praça|praca|viela|bairro|jd|jardim|vila|cep)\M')
    OR p ~* '\m(mônica|monica|irmã|irma|irmão|irmao|tia|você|voce|vc|senhora|obrigad[oa]|deus|senhor|tô|devendo|parcela|pagamento|paguei|mando|querida|amiga|foto|tudo bem|atendimento|catálogo|catalogo|tamanho|saia|vestido|blusa|modelos?|valor|kit|medida|cadeiras?|pode ser|será|sera|olha|muito lindo|metros)\M'
    OR p ~* '^\s*(oi|olá|ola|tá|ta|bom dia|boa tarde|boa noite|então|entao|é|e que|aí|ai|sim+|não|nao|ok|amém|amem|eu|a paz|nos temos|tem |palavra)\M'
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_customer_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     AND NEW.address IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.address IS DISTINCT FROM OLD.address)
     AND public.address_looks_like_message(NEW.address) THEN
    NEW.address := CASE WHEN TG_OP = 'UPDATE' THEN OLD.address ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_address ON public.customers;
CREATE TRIGGER trg_guard_customer_address
  BEFORE INSERT OR UPDATE OF address ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_address();
