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
-- O QUE MUDA. A regra de linha continua a mesma (a loja lê a configuração); o
-- que se fecha é o acesso por COLUNA para quem não tem login. Quem está logado
-- (equipe) continua vendo tudo, inclusive a tela de Pedidos da loja.
--
-- COMO. Privilégio de coluna não anula privilégio de tabela: enquanto o anon
-- tiver SELECT na tabela inteira, revogar coluna a coluna não muda nada (a
-- primeira tentativa desta migração falhou exatamente aí). O caminho é tirar o
-- SELECT da tabela e devolver só o das três colunas públicas.
--
-- A loja já pede só essas três (src/store/api.ts, fetchStoreSettings), então
-- nada na vitrine muda.
REVOKE SELECT ON public.store_settings FROM anon;
GRANT  SELECT (whatsapp, pickup_address, delivery_note)
  ON public.store_settings TO anon;

-- Escrever sem login nunca foi permitido pela regra de linha, mas o privilégio
-- estava lá. Some também, para não depender de uma camada só.
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.store_settings FROM anon;

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
     OR has_column_privilege('anon', 'public.store_settings', 'payment_link_enabled', 'SELECT')
     OR has_column_privilege('anon', 'public.store_settings', 'payment_link_hours', 'SELECT')
     OR has_column_privilege('anon', 'public.store_settings', 'order_confirm_customer', 'SELECT') THEN
    RAISE EXCEPTION 'As colunas internas continuam legíveis sem login.';
  END IF;

  -- a equipe não pode perder nada
  IF NOT has_column_privilege('authenticated', 'public.store_settings', 'order_alert_whatsapp', 'SELECT') THEN
    RAISE EXCEPTION 'A equipe perdeu acesso ao número de aviso de pedidos.';
  END IF;
END
$confere$;
