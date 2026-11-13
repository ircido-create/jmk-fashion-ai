-- Uma pergunta só para "o WhatsApp está vivo?".
--
-- O Painel e a tela de WhatsApp montavam esse quadro com quatro leituras
-- diretas em whatsapp_messages, filtrando por direction e ordenando por
-- created_at. Em 13/11/2026 essas leituras passaram a voltar **HTTP 500** pela
-- API (a mesma consulta roda em 58 ms no editor SQL, e o índice novo
-- 20261113160000 não mudou isso — o problema está no caminho da API, não no
-- banco). Sem resposta, a tela escreve "Última mensagem recebida: nunca" e
-- acende "Possível desconexão do WhatsApp" — com o WhatsApp funcionando:
-- 1.180 mensagens recebidas em 24 h, a última um segundo antes da checagem.
--
-- O QUE MUDA. As telas passam a fazer **uma** chamada, a esta função, que
-- responde uma linha com o resumo. Além de contornar o 500, é muito mais
-- barato: uma ida ao banco em vez de quatro, e cada número sai de um índice.
--
-- Quem pode chamar: só a equipe (is_staff). A função é SECURITY DEFINER para
-- não depender da política linha a linha de uma tabela de 75 mil registros,
-- mas confere o papel logo na primeira linha e não devolve nenhum texto de
-- mensagem — só datas e contagens.
CREATE OR REPLACE FUNCTION public.whatsapp_pulso()
RETURNS TABLE (
  ultima_recebida   timestamptz,
  ultima_enviada    timestamptz,
  recebidas_24h     integer,
  enviadas_24h      integer,
  falhas_24h        integer,
  atraso_medio_min  numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Só a equipe pode ver o pulso do WhatsApp.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT max(m.created_at) FROM whatsapp_messages m WHERE m.direction = 'inbound'),
    (SELECT max(m.created_at) FROM whatsapp_messages m WHERE m.direction = 'outbound'),
    (SELECT count(*)::int FROM whatsapp_messages m
      WHERE m.direction = 'inbound' AND m.created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM whatsapp_messages m
      WHERE m.direction = 'outbound' AND m.created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM whatsapp_send_failures f
      WHERE f.created_at > now() - interval '24 hours'),
    -- atraso de entrega do provedor: quanto tempo a mensagem levou do celular
    -- da cliente até o sistema, média das 20 últimas que trazem sent_at.
    (SELECT round(avg(extract(epoch FROM (u.created_at - u.sent_at)) / 60)::numeric, 1)
       FROM (SELECT m.created_at, m.sent_at FROM whatsapp_messages m
              WHERE m.direction = 'inbound' AND m.sent_at IS NOT NULL
              ORDER BY m.created_at DESC LIMIT 20) u);
END
$$;

REVOKE ALL ON FUNCTION public.whatsapp_pulso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_pulso() TO authenticated;

DO $confere$
DECLARE
  v_rec timestamptz;
  v_24h integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public' AND pr.proname = 'whatsapp_pulso'
  ) THEN
    RAISE EXCEPTION 'A função não foi criada.';
  END IF;

  IF has_function_privilege('anon', 'public.whatsapp_pulso()', 'EXECUTE') THEN
    RAISE EXCEPTION 'O visitante da loja consegue chamar a função.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.whatsapp_pulso()', 'EXECUTE') THEN
    RAISE EXCEPTION 'A equipe não consegue chamar a função.';
  END IF;

  -- O editor SQL roda como postgres, sem sessão de usuário: ali is_staff() é
  -- falso e a própria função recusa, como tem de recusar. Só dá para ver o
  -- resultado quando quem roda está logado como equipe.
  IF public.is_staff() THEN
    SELECT p.ultima_recebida, p.recebidas_24h INTO v_rec, v_24h FROM public.whatsapp_pulso() p;
    IF v_rec IS NULL THEN
      RAISE EXCEPTION 'A função não achou nenhuma mensagem recebida — não é o esperado.';
    END IF;
    RAISE NOTICE 'Pulso: última recebida em %, % nas últimas 24 h.', v_rec, v_24h;
  ELSE
    RAISE NOTICE 'Função criada e com acesso certo. O resultado se confere pela tela, logado.';
  END IF;
END
$confere$;
