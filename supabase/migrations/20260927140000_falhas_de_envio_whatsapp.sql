-- Registro de falhas de envio do WhatsApp (respostas da Mônica).
--
-- Em 26–27/09 o BubbleWhats parou de aceitar envios: a Mônica ficou ~24h sem
-- responder ninguém e só a cobrança (dunning_runs) mostrava sinal. As falhas da
-- Mônica iam apenas para o log da edge function, que some em poucas horas.
-- Agora cada envio que falha (HTTP de erro, "status": false, timeout ou erro de
-- rede) vira uma linha aqui, e a tela WhatsApp avisa.
CREATE TABLE IF NOT EXISTS public.whatsapp_send_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL,          -- ex.: 'monica'
  endpoint text,                 -- ex.: '/send-message'
  destino text,                  -- jid/telefone
  http_status integer,           -- 0 = timeout ou erro de rede
  detalhe text                   -- corpo da resposta ou mensagem do erro (cortado)
);

CREATE INDEX IF NOT EXISTS whatsapp_send_failures_created_at_idx
  ON public.whatsapp_send_failures (created_at DESC);

ALTER TABLE public.whatsapp_send_failures ENABLE ROW LEVEL SECURITY;

-- Leitura só para a equipe; a gravação é feita pelas edge functions (service role).
DROP POLICY IF EXISTS "equipe le falhas de envio" ON public.whatsapp_send_failures;
CREATE POLICY "equipe le falhas de envio" ON public.whatsapp_send_failures
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'vendedor'::public.app_role));

-- Guarda 30 dias.
SELECT cron.unschedule('jmk-limpa-falhas-envio')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-limpa-falhas-envio');
SELECT cron.schedule('jmk-limpa-falhas-envio', '30 4 * * *',
  $$DELETE FROM public.whatsapp_send_failures WHERE created_at < now() - interval '30 days'$$);
