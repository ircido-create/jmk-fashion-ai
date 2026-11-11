-- A loja virtual passa a enxergar só as três colunas que ela usa.
--
-- POR QUÊ. store_settings é a única tabela do sistema que pode ser lida sem
-- login: a loja precisa do WhatsApp da loja, do endereço de retirada e do aviso
-- de entrega para montar a página. A regra de leitura, porém, é "a linha
-- inteira" — e a linha hoje também guarda:
--     order_alert_whatsapp    número que recebe o aviso de cada pedido
--     order_confirm_customer  se a loja confirma o pedido com a cliente
--     payment_link_enabled    se o link de pagamento está ligado
--     payment_link_hours      por quantas horas o link vale
-- Nada disso é segredo grave, mas é configuração interna da loja exposta a
-- qualquer pessoa que abra o site e leia o JavaScript. É o aviso "Anyone can
-- read every record in store_settings" da varredura de segurança do Lovable.
--
-- O QUE MUDA. Regra de linha continua a mesma (a loja lê a configuração); o que
-- se fecha é o acesso por COLUNA para quem não tem login. Quem está logado
-- (equipe) continua vendo tudo, inclusive a tela de Pedidos da loja.
--
-- A loja já pede só as três colunas públicas (src/store/api.ts, fetchStoreSettings),
-- então nada na vitrine muda.
REVOKE SELECT (order_alert_whatsapp, order_confirm_customer,
               payment_link_enabled, payment_link_hours)
  ON public.store_settings FROM anon;

-- Escrita sem login nunca foi permitida pela regra de linha; aqui fecha também
-- o privilégio, para não depender de uma regra só.
REVOKE INSERT, UPDATE, DELETE ON public.store_settings FROM anon;

DO $confere$
BEGIN
  -- a vitrine precisa continuar lendo estas três
  IF NOT (has_column_privilege('anon', 'public.store_settings', 'whatsapp', 'SELECT')
      AND has_column_privilege('anon', 'public.store_settings', 'pickup_address', 'SELECT')
      AND has_column_privilege('anon', 'public.store_settings', 'delivery_note', 'SELECT')) THEN
    RAISE EXCEPTION 'A loja perdeu acesso a alguma coluna pública — a vitrine quebraria.';
  END IF;

  -- e não pode mais ler as internas
  IF has_column_privilege('anon', 'public.store_settings', 'order_alert_whatsapp', 'SELECT')
     OR has_column_privilege('anon', 'public.store_settings', 'payment_link_enabled', 'SELECT') THEN
    RAISE EXCEPTION 'As colunas internas continuam legíveis sem login.';
  END IF;

  -- a equipe não pode perder nada
  IF NOT has_column_privilege('authenticated', 'public.store_settings', 'order_alert_whatsapp', 'SELECT') THEN
    RAISE EXCEPTION 'A equipe perdeu acesso ao número de aviso de pedidos.';
  END IF;
END
$confere$;
