-- Clientes duplicados e conversas sem cliente.
--
-- Causa (23/09/2026): cadastros feitos pela tela guardavam o telefone
-- formatado ("+55 11 98748-0029"). A Mônica busca a cliente com
-- phone ILIKE '%5511987480029%' — que não casa com espaços/hífen — e, sem
-- achar, criava outro cadastro com o apelido do WhatsApp. Resultado: 72 pares
-- com o mesmo telefone; em 64 deles as parcelas ficam num cadastro e a
-- conversa no outro, e a baixa automática/saldo olham o cadastro errado.
-- Além disso, a conversa só era ligada à cliente no momento em que era
-- criada (170 conversas sem cliente).
--
-- 1) Telefone de cliente passa a ser gravado só com dígitos (trigger).
-- 2) Conversa é ligada automaticamente à cliente quando o telefone casa com
--    UMA única cliente — na criação da conversa e no cadastro/edição da cliente.
-- 3) merge_customers: junta dois cadastros movendo TODAS as referências numa
--    única transação (a edge function merge-customers só movia vendas e
--    parcelas; conversa, comprovantes e cobrança perdiam o vínculo).

-- ---------------------------------------------------------------------------
-- 1) Telefone só com dígitos
CREATE OR REPLACE FUNCTION public.normalize_customer_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.phone := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g'), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_customer_phone ON public.customers;
CREATE TRIGGER trg_normalize_customer_phone
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_phone();

-- ---------------------------------------------------------------------------
-- 2) Cliente pelo telefone (mesma regra do webhook: com/sem 55, sufixo).
-- Só devolve quando há exatamente UMA cliente possível. Grupos (@g.us) e
-- números fora do padrão não casam.
CREATE OR REPLACE FUNCTION public.resolve_customer_by_phone(p_phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_variants text[];
  v_ids uuid[];
BEGIN
  IF p_phone IS NULL OR p_phone LIKE '%@g.us%' OR length(v_phone) < 10 OR length(v_phone) > 13 THEN
    RETURN NULL;
  END IF;

  v_variants := ARRAY[v_phone];
  IF v_phone LIKE '55%' THEN v_variants := v_variants || substr(v_phone, 3);
  ELSE v_variants := v_variants || ('55' || v_phone);
  END IF;

  SELECT array_agg(DISTINCT x.id) INTO v_ids
    FROM public.customers x
    CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(x.phone, ''), '\D', '', 'g') AS d) n
    CROSS JOIN LATERAL unnest(v_variants) v
   WHERE length(n.d) >= 10
     AND (n.d = v OR n.d LIKE '%' || v OR v LIKE '%' || n.d);

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
  RETURN NULL;
END;
$$;

-- A baixa automática passa a usar a mesma regra.
CREATE OR REPLACE FUNCTION public.resolve_payment_proof_customer(p_whatsapp_message_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv_customer uuid;
  v_phone text;
BEGIN
  IF p_whatsapp_message_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.customer_id, c.customer_phone
    INTO v_conv_customer, v_phone
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
   WHERE m.id = p_whatsapp_message_id;

  RETURN COALESCE(v_conv_customer, public.resolve_customer_by_phone(v_phone));
END;
$$;

-- Conversa nova sem cliente → tenta achar pelo telefone.
CREATE OR REPLACE FUNCTION public.link_new_conversation_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    NEW.customer_id := public.resolve_customer_by_phone(NEW.customer_phone);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_new_conversation_customer ON public.whatsapp_conversations;
CREATE TRIGGER trg_link_new_conversation_customer
  BEFORE INSERT ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.link_new_conversation_customer();

-- Cliente cadastrada/telefone alterado → liga as conversas sem cliente desse número.
CREATE OR REPLACE FUNCTION public.link_conversations_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.phone IS NULL THEN RETURN NULL; END IF;
  UPDATE public.whatsapp_conversations w
     SET customer_id = NEW.id
   WHERE w.customer_id IS NULL
     AND right(regexp_replace(w.customer_phone, '\D', '', 'g'), 8) = right(NEW.phone, 8)
     AND public.resolve_customer_by_phone(w.customer_phone) = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_conversations_to_customer ON public.customers;
CREATE TRIGGER trg_link_conversations_to_customer
  AFTER INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.link_conversations_to_customer();

-- ---------------------------------------------------------------------------
-- 3) Junta dois cadastros. Tudo ou nada.
CREATE OR REPLACE FUNCTION public.merge_customers(p_keep uuid, p_drop uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_keep public.customers%ROWTYPE;
  v_drop public.customers%ROWTYPE;
  v_moves jsonb := '{}'::jsonb;
  v_count integer;
  v_table text;
  v_filled text[] := ARRAY[]::text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Somente administradores podem juntar cadastros';
  END IF;
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'Escolha dois cadastros diferentes';
  END IF;

  SELECT * INTO v_keep FROM public.customers WHERE id = p_keep FOR UPDATE;
  SELECT * INTO v_drop FROM public.customers WHERE id = p_drop FOR UPDATE;
  IF v_keep.id IS NULL OR v_drop.id IS NULL THEN
    RAISE EXCEPTION 'Cadastro não encontrado — recarregue a tela';
  END IF;

  -- Move todas as referências.
  FOREACH v_table IN ARRAY ARRAY['accounts_receivable', 'sales', 'pre_sales', 'payment_proofs',
                                 'whatsapp_conversations', 'dunning_logs', 'store_orders'] LOOP
    EXECUTE format('UPDATE public.%I SET customer_id = $1 WHERE customer_id = $2', v_table)
      USING p_keep, p_drop;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moves := v_moves || jsonb_build_object(v_table, v_count);
  END LOOP;

  -- Completa o que falta no cadastro mantido. O nome do outro cadastro
  -- (em geral o apelido do WhatsApp) vira apelido, se não houver um.
  IF v_keep.nickname IS NULL OR trim(v_keep.nickname) = '' THEN
    IF v_drop.nickname IS NOT NULL AND trim(v_drop.nickname) <> '' THEN
      v_keep.nickname := v_drop.nickname; v_filled := v_filled || 'apelido';
    ELSIF v_drop.name IS NOT NULL AND v_drop.name <> '(sem nome)' AND lower(trim(v_drop.name)) <> lower(trim(v_keep.name)) THEN
      v_keep.nickname := v_drop.name; v_filled := v_filled || 'apelido';
    END IF;
  END IF;
  IF (v_keep.tax_id IS NULL OR v_keep.tax_id = '') AND v_drop.tax_id IS NOT NULL AND v_drop.tax_id <> '' THEN
    v_keep.tax_id := v_drop.tax_id; v_filled := v_filled || 'CPF/CNPJ';
  END IF;
  IF v_keep.phone IS NULL AND v_drop.phone IS NOT NULL THEN
    v_keep.phone := v_drop.phone; v_filled := v_filled || 'telefone';
  END IF;
  IF (v_keep.email IS NULL OR v_keep.email = '') AND v_drop.email IS NOT NULL AND v_drop.email <> '' THEN
    v_keep.email := v_drop.email; v_filled := v_filled || 'e-mail';
  END IF;
  IF (v_keep.address IS NULL OR v_keep.address = '') AND v_drop.address IS NOT NULL AND v_drop.address <> '' THEN
    v_keep.address := v_drop.address; v_filled := v_filled || 'endereço';
  END IF;
  IF v_drop.notes IS NOT NULL AND v_drop.notes <> '' THEN
    v_keep.notes := CASE WHEN v_keep.notes IS NULL OR v_keep.notes = '' THEN v_drop.notes
                         ELSE v_keep.notes || E'\n' || v_drop.notes END;
    v_filled := v_filled || 'observações';
  END IF;

  DELETE FROM public.customer_merge_ignored WHERE customer_a_id = p_drop OR customer_b_id = p_drop;
  DELETE FROM public.customers WHERE id = p_drop;

  UPDATE public.customers
     SET nickname = v_keep.nickname, tax_id = v_keep.tax_id, phone = v_keep.phone,
         email = v_keep.email, address = v_keep.address, notes = v_keep.notes
   WHERE id = p_keep;

  RETURN jsonb_build_object('moves', v_moves, 'filled', to_jsonb(v_filled));
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_customer_by_phone(text) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dados existentes: telefones só com dígitos e conversas ligadas quando o
-- número casa com uma única cliente. Os pares duplicados ficam para a tela de
-- Conciliação de cadastros (a junção exige conferência de um administrador).
UPDATE public.customers SET phone = phone WHERE phone ~ '\D';

UPDATE public.whatsapp_conversations w
   SET customer_id = public.resolve_customer_by_phone(w.customer_phone)
 WHERE w.customer_id IS NULL
   AND public.resolve_customer_by_phone(w.customer_phone) IS NOT NULL;
