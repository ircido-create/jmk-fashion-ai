-- Registro de toda leitura de imagem/PDF recebida no WhatsApp (comprovante ou não).
--
-- Caso LETICIA (05/10/2026): um comprovante Nubank legível de R$ 220 não virou
-- comprovante e a cliente ficou sem resposta. Não havia como saber se a leitura
-- disse "não é comprovante" ou se falhou: só os comprovantes reconhecidos eram
-- gravados, e o log da função some em horas. Agora cada leitura vira uma linha.
--   resultado: 'comprovante' | 'nao_comprovante' | 'erro'
CREATE TABLE IF NOT EXISTS public.whatsapp_media_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  whatsapp_message_id uuid,
  conversation_id uuid,
  customer_id uuid,
  media_path text,
  mime_type text,
  resultado text NOT NULL,
  valor numeric,
  resumo text,         -- o que a leitura disse da imagem
  detalhe text,        -- erro (HTTP, JSON inválido, exceção) quando houver
  proof_id uuid        -- comprovante gravado, quando reconhecido
);

CREATE INDEX IF NOT EXISTS whatsapp_media_analysis_created_at_idx
  ON public.whatsapp_media_analysis (created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_media_analysis_message_idx
  ON public.whatsapp_media_analysis (whatsapp_message_id);

ALTER TABLE public.whatsapp_media_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipe le leituras de imagem" ON public.whatsapp_media_analysis;
CREATE POLICY "equipe le leituras de imagem" ON public.whatsapp_media_analysis
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'vendedor'::public.app_role));

-- Guarda 90 dias.
SELECT cron.unschedule('jmk-limpa-leituras-imagem')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jmk-limpa-leituras-imagem');
SELECT cron.schedule('jmk-limpa-leituras-imagem', '45 4 * * *',
  $$DELETE FROM public.whatsapp_media_analysis WHERE created_at < now() - interval '90 days'$$);
