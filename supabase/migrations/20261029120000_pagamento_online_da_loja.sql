-- Pagamento online do pedido da loja virtual (InfinitePay).
--
-- Até aqui a cliente fechava a sacola, as peças saíam do estoque e não havia
-- como pagar: tudo era combinado depois, no WhatsApp. Agora cada pedido pode
-- ganhar um link de pagamento (Pix ou cartão) que vai junto com o aviso que o
-- pedido já manda.
--
-- O que este arquivo NÃO faz, de propósito: mexer na cobrança das parcelas de
-- fiado. A rodada das 10h (dunning-cron) continua exatamente como está, sem
-- link — foi decisão da loja. Por isso a cobrança aqui aponta para
-- store_orders, e não para accounts_receivable.
--
-- Regra de ouro do dinheiro: nada aqui confia no navegador. O valor vem de
-- store_orders.total, e o pagamento só é dado como certo depois que a edge
-- function confirma na InfinitePay (POST /payment_check) — o webhook deles não
-- tem assinatura, então a notificação sozinha não vale como prova.

-- ============ 1) Ajustes da loja ============
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS payment_link_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_link_hours   int     NOT NULL DEFAULT 72;

COMMENT ON COLUMN public.store_settings.payment_link_enabled IS
  'Gera link de pagamento para o pedido da loja. Começa desligado: só liga quando a chave da InfinitePay estiver no cofre.';
COMMENT ON COLUMN public.store_settings.payment_link_hours IS
  'Por quantas horas o link vale. Depois disso a cliente combina o pagamento pelo WhatsApp, como antes.';

-- ============ 2) A cobrança ============
-- Uma por pedido (o índice único garante): se o envio falhar, a loja tenta de
-- novo sem gerar segunda cobrança para a mesma compra.
CREATE TABLE IF NOT EXISTS public.payment_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  provider        text NOT NULL DEFAULT 'infinitepay',
  order_nsu       text NOT NULL,
  description     text NOT NULL,
  amount_cents    int  NOT NULL CHECK (amount_cents > 0),
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'aguardando', 'pago', 'estornado', 'cancelado', 'expirado', 'falhou')),
  link_url        text,
  provider_slug   text,
  link_expires_at timestamptz,
  last_error      text,
  paid_at         timestamptz,
  paid_cents      int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_charges_order_uidx ON public.payment_charges (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_charges_nsu_uidx   ON public.payment_charges (provider, order_nsu);
CREATE INDEX IF NOT EXISTS payment_charges_status_idx        ON public.payment_charges (status, created_at DESC);

COMMENT ON TABLE public.payment_charges IS
  'Cobrança online de um pedido da loja virtual. O valor sai de store_orders.total, nunca do navegador.';

-- ============ 3) O que a InfinitePay confirmou ============
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id         uuid NOT NULL REFERENCES public.payment_charges(id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'infinitepay',
  transaction_nsu   text NOT NULL,
  status            text NOT NULL,
  amount_cents      int,
  paid_amount_cents int,
  payment_method    text,
  installments      int,
  provider_payload  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- A mesma transação não entra duas vezes: é isto que impede baixa dobrada
-- quando a InfinitePay reenvia o webhook.
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_nsu_uidx
  ON public.payment_transactions (provider, transaction_nsu, status);
CREATE INDEX IF NOT EXISTS payment_transactions_charge_idx
  ON public.payment_transactions (charge_id, created_at DESC);

-- ============ 4) Tudo que o provedor mandou ============
-- Guarda o aviso antes de processar. Serve de prova e de fila: se o
-- processamento falhar, a linha fica com o erro e dá para repetir.
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL DEFAULT 'infinitepay',
  event_key         text NOT NULL,
  event_type        text,
  payload           jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'recebido'
                    CHECK (processing_status IN ('recebido', 'processado', 'ignorado', 'erro')),
  error_message     text,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_key_uidx
  ON public.payment_webhook_events (provider, event_key);

-- ============ 5) Quem pode ver o quê ============
ALTER TABLE public.payment_charges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipe ve cobrancas"   ON public.payment_charges;
DROP POLICY IF EXISTS "equipe ve transacoes"  ON public.payment_transactions;
CREATE POLICY "equipe ve cobrancas" ON public.payment_charges
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'vendedor'::public.app_role));
CREATE POLICY "equipe ve transacoes" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'vendedor'::public.app_role));

-- Sem política de escrita em lugar nenhum: quem grava são as funções abaixo.
-- Nem a equipe marca um pedido como pago na mão por aqui — pagamento só entra
-- com confirmação da InfinitePay.
REVOKE ALL ON public.payment_charges, public.payment_transactions, public.payment_webhook_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_charges, public.payment_transactions FROM authenticated;
REVOKE ALL ON public.payment_webhook_events FROM authenticated;

-- O aviso do pedido passa a registrar também o link e a confirmação do pagamento.
ALTER TABLE public.store_order_alerts DROP CONSTRAINT IF EXISTS store_order_alerts_kind_check;
ALTER TABLE public.store_order_alerts
  ADD CONSTRAINT store_order_alerts_kind_check
  CHECK (kind IN ('loja', 'cliente', 'link-pagamento', 'pagamento-confirmado'));

-- ============ 6) Abrir a cobrança ============
-- Idempotente: chamada duas vezes para o mesmo pedido, devolve a mesma linha.
-- Nunca recria uma cobrança já paga.
CREATE OR REPLACE FUNCTION public.store_charge_open(p_order_id uuid)
RETURNS public.payment_charges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_o store_orders%ROWTYPE;
  v_c payment_charges%ROWTYPE;
  v_horas int;
BEGIN
  SELECT * INTO v_o FROM store_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_o.status = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado não recebe cobrança'; END IF;
  IF v_o.total <= 0 THEN RAISE EXCEPTION 'Pedido sem valor'; END IF;

  SELECT * INTO v_c FROM payment_charges WHERE order_id = p_order_id;
  IF FOUND THEN
    IF v_c.status IN ('pago', 'estornado') THEN RETURN v_c; END IF;
    -- Valor do pedido mudou (item alterado antes de pagar): a cobrança
    -- acompanha, e o link velho é descartado para não cobrar o valor errado.
    IF v_c.amount_cents <> round(v_o.total * 100)::int THEN
      UPDATE payment_charges
         SET amount_cents = round(v_o.total * 100)::int,
             link_url = NULL, provider_slug = NULL, link_expires_at = NULL,
             status = 'rascunho', updated_at = now()
       WHERE id = v_c.id
      RETURNING * INTO v_c;
    END IF;
    RETURN v_c;
  END IF;

  SELECT coalesce(payment_link_hours, 72) INTO v_horas FROM store_settings LIMIT 1;

  INSERT INTO payment_charges (order_id, customer_id, order_nsu, description, amount_cents, link_expires_at)
  VALUES (v_o.id, v_o.customer_id, 'JMK-' || v_o.code,
          'Pedido ' || v_o.code || ' — JMK Modas',
          round(v_o.total * 100)::int,
          now() + make_interval(hours => coalesce(v_horas, 72)))
  RETURNING * INTO v_c;

  RETURN v_c;
END;
$fn$;

REVOKE ALL ON FUNCTION public.store_charge_open(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.store_charge_open(uuid) TO authenticated, service_role;

-- ============ 7) Guardar o link que a InfinitePay devolveu ============
-- Só a edge function (service_role) chama: é ela que tem a chave da API.
CREATE OR REPLACE FUNCTION public.store_charge_set_link(
  p_charge_id uuid,
  p_url       text,
  p_slug      text DEFAULT NULL,
  p_expires   timestamptz DEFAULT NULL,
  p_error     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_error IS NOT NULL THEN
    UPDATE payment_charges
       SET status = CASE WHEN status IN ('pago','estornado') THEN status ELSE 'falhou' END,
           last_error = left(p_error, 500), updated_at = now()
     WHERE id = p_charge_id;
    RETURN;
  END IF;

  IF coalesce(btrim(p_url), '') = '' THEN
    RAISE EXCEPTION 'Link vazio — a loja não guarda link inventado';
  END IF;

  UPDATE payment_charges
     SET link_url = p_url,
         provider_slug = p_slug,
         link_expires_at = coalesce(p_expires, link_expires_at),
         status = CASE WHEN status IN ('pago','estornado') THEN status ELSE 'aguardando' END,
         last_error = NULL,
         updated_at = now()
   WHERE id = p_charge_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.store_charge_set_link(uuid, text, text, timestamptz, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_charge_set_link(uuid, text, text, timestamptz, text) TO service_role;

-- ============ 8) Registrar o pagamento ============
-- Chamada pela edge function DEPOIS de confirmar em /payment_check. Idempotente
-- nos dois sentidos: a mesma transação não entra duas vezes e um pedido já
-- confirmado não vira venda de novo.
CREATE OR REPLACE FUNCTION public.store_charge_settle(
  p_charge_id       uuid,
  p_transaction_nsu text,
  p_status          text,
  p_paid_cents      int,
  p_method          text DEFAULT NULL,
  p_installments    int  DEFAULT NULL,
  p_payload         jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_c      payment_charges%ROWTYPE;
  v_o      store_orders%ROWTYPE;
  v_admin  uuid;
  v_metodo text;
  v_novo   boolean := false;
BEGIN
  SELECT * INTO v_c FROM payment_charges WHERE id = p_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança não encontrada'; END IF;

  INSERT INTO payment_transactions
    (charge_id, transaction_nsu, status, amount_cents, paid_amount_cents, payment_method, installments, provider_payload)
  VALUES
    (v_c.id, p_transaction_nsu, p_status, v_c.amount_cents, p_paid_cents, p_method, p_installments, p_payload)
  ON CONFLICT (provider, transaction_nsu, status) DO NOTHING;
  v_novo := FOUND;

  IF p_status NOT IN ('paid', 'settled') THEN
    -- Recusa e cancelamento não mexem no financeiro: só ficam registrados.
    IF p_status = 'refunded' THEN
      UPDATE payment_charges SET status = 'estornado', updated_at = now() WHERE id = v_c.id;
    ELSIF p_status IN ('canceled', 'payment_failed') AND v_c.status NOT IN ('pago', 'estornado') THEN
      UPDATE payment_charges SET status = CASE WHEN p_status = 'canceled' THEN 'cancelado' ELSE 'aguardando' END,
             last_error = CASE WHEN p_status = 'payment_failed' THEN 'Pagamento não aprovado' ELSE NULL END,
             updated_at = now()
       WHERE id = v_c.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'novo', v_novo, 'situacao', p_status);
  END IF;

  IF v_c.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'novo', false, 'situacao', 'ja_estava_pago');
  END IF;

  UPDATE payment_charges
     SET status = 'pago', paid_at = now(), paid_cents = p_paid_cents, last_error = NULL, updated_at = now()
   WHERE id = v_c.id;

  -- O pedido vira venda pelo mesmo caminho do painel, para não existirem duas
  -- regras diferentes de confirmação. store_update_order exige um admin logado,
  -- e aqui quem chama é a função do servidor: empresta a identidade de um admin
  -- só para esta transação.
  SELECT * INTO v_o FROM store_orders WHERE id = v_c.order_id;
  IF FOUND AND v_o.status = 'novo' THEN
    SELECT user_id INTO v_admin FROM user_roles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
    IF v_admin IS NOT NULL THEN
      v_metodo := CASE WHEN p_method = 'pix' THEN 'pix' ELSE 'credito' END;
      PERFORM set_config('request.jwt.claims',
                         json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      PERFORM public.store_update_order(v_o.id, 'confirmado', v_metodo);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'novo', v_novo, 'situacao', 'pago');
END;
$fn$;

REVOKE ALL ON FUNCTION public.store_charge_settle(uuid, text, text, int, text, int, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_charge_settle(uuid, text, text, int, text, int, jsonb) TO service_role;

-- ============ 9) A cliente vê o próprio link ============
-- A tela de "pedido recebido" roda sem login. Pede pelo código do pedido, que
-- ela acabou de receber, e devolve só o link e a situação — nada de nome,
-- telefone ou endereço, que é o motivo de a confirmação nunca ter consultado o
-- banco até hoje.
CREATE OR REPLACE FUNCTION public.store_order_payment(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
           'status', c.status,
           'link_url', CASE WHEN c.status = 'aguardando'
                             AND (c.link_expires_at IS NULL OR c.link_expires_at > now())
                            THEN c.link_url END,
           'expira_em', c.link_expires_at,
           'valor_centavos', c.amount_cents)
    FROM payment_charges c
    JOIN store_orders o ON o.id = c.order_id
   WHERE upper(o.code) = upper(btrim(p_code))
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION public.store_order_payment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.store_order_payment(text) TO anon, authenticated;
