-- Índice para "qual foi a última mensagem recebida/enviada".
--
-- O Painel e a tela de WhatsApp perguntam, a cada abertura:
--
--   SELECT created_at FROM whatsapp_messages
--    WHERE direction = 'inbound' ORDER BY created_at DESC LIMIT 1;
--
-- Não existia índice que atendesse esse par (direction, created_at) — só o de
-- (conversation_id, created_at), que serve para abrir uma conversa. Resultado:
-- varredura das 75 mil linhas da tabela e ordenação, em toda abertura de tela.
-- Em 13/11/2026 essa chamada passou a voltar HTTP 500 pela API, e sem resposta
-- a tela escreve "Última mensagem recebida: nunca" e acende o alerta vermelho
-- de "Possível desconexão do WhatsApp" — com o WhatsApp funcionando: 1.180
-- mensagens recebidas nas últimas 24 h, a última um segundo antes da checagem.
--
-- O QUE MUDA. Com o índice, a mesma pergunta vira uma leitura direta da ponta
-- do índice, sem varrer nem ordenar nada. A tabela só cresce, então isso vale
-- para hoje e para daqui a um ano.
--
-- Nada é apagado e nenhuma consulta muda de resultado: índice só muda o
-- caminho que o banco percorre para chegar na mesma resposta.
CREATE INDEX IF NOT EXISTS idx_wa_messages_direction_created
  ON public.whatsapp_messages (direction, created_at DESC);

-- O banco só usa índice novo depois de saber o tamanho dele.
ANALYZE public.whatsapp_messages;

DO $confere$
DECLARE
  v_plano text;
  v_linha text;
  v_varre boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'whatsapp_messages'
       AND indexname = 'idx_wa_messages_direction_created'
  ) THEN
    RAISE EXCEPTION 'O índice não foi criado.';
  END IF;

  -- o plano da pergunta das telas precisa deixar de varrer a tabela
  FOR v_linha IN
    EXPLAIN SELECT created_at FROM public.whatsapp_messages
             WHERE direction = 'inbound' ORDER BY created_at DESC LIMIT 1
  LOOP
    v_plano := coalesce(v_plano || ' / ', '') || v_linha;
    IF v_linha ILIKE '%Seq Scan%' THEN
      v_varre := true;
    END IF;
  END LOOP;

  IF v_varre THEN
    RAISE EXCEPTION 'O banco ainda varre a tabela inteira: %', v_plano;
  END IF;

  RAISE NOTICE 'Pronto. Plano agora: %', v_plano;
END
$confere$;
