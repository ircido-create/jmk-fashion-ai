-- Pausa de cobrança com data de volta — e a da Carla passa para 29/11/2026.
--
-- O PROBLEMA. A pausa da cobrança só tem ligado/desligado. A data combinada
-- com a cliente fica escrita na nota do cadastro, e alguém precisa lembrar de
-- religar no dia certo. Já aconteceu duas vezes em duas semanas (Carla, para
-- 11/11, e Sandra Prima, para 12/11): se ninguém lembra, a cliente nunca mais
-- é cobrada; se alguém lembra tarde, a loja perde dias de cobrança.
--
-- O QUE MUDA AQUI. Nasce a coluna dunning_paused_until (a data em que a
-- cobrança volta) e a função que religa quem chegou nela. Esta migração NÃO
-- agenda nada: a função só roda se alguém a chamar. Quem liga o despertador
-- diário é a migração seguinte, separada de propósito, porque criar rotina
-- que roda todo dia sozinha é decisão da loja, não minha.
--
-- Enquanto o despertador não for ligado, a data fica registrada no cadastro
-- e a volta é na mão, como já era.
--
-- A regra da cobrança NÃO é tocada: ela continua olhando só dunning_paused.
-- Assim a mudança não tem como cobrar alguém por engano; o máximo que pode
-- acontecer, se a rotina falhar, é a cliente seguir pausada, que é o estado
-- seguro.
--
-- E A CARLA. Em 30/10 ela avisou que quitava no dia 10, e a pausa ia até
-- 11/11 — hoje. O José pediu para religar só no dia 29, então a volta fica
-- marcada para 29/11/2026 e acontece sozinha.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS dunning_paused_until date;

COMMENT ON COLUMN public.customers.dunning_paused_until IS
  'Dia em que a cobrança automática volta sozinha (rotina jmk-dunning-resume). Nulo = pausa sem data, só sai na mão.';

-- Religa quem chegou no dia combinado.
CREATE OR REPLACE FUNCTION public.dunning_resume_due()
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_qtd  int;
BEGIN
  UPDATE public.customers
     SET dunning_paused = false,
         dunning_paused_until = NULL,
         dunning_pause_note = left(
           coalesce(dunning_pause_note || ' ', '')
           || 'Cobrança religada automaticamente em ' || to_char(v_hoje, 'DD/MM/YYYY') || '.', 1000),
         updated_at = now()
   WHERE dunning_paused
     AND dunning_paused_until IS NOT NULL
     AND dunning_paused_until <= v_hoje;

  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$fn$;

COMMENT ON FUNCTION public.dunning_resume_due() IS
  'Tira da pausa quem chegou na data de volta. Roda todo dia às 09:30 (BRT), antes da cobrança das 10h.';

-- A Carla volta a ser cobrada no dia 29.
DO $carla$
DECLARE
  v_id uuid := 'f4ede3bf-aff8-407a-a01d-5aaf263f6180';
BEGIN
  UPDATE public.customers
     SET dunning_paused = true,
         dunning_paused_until = DATE '2026-11-29',
         dunning_pause_note = 'Pausada até 29/11/2026 — em 30/10 avisou no WhatsApp que ficou apertada, pagou R$ 150,00 e quitava o restante no dia 10. Em 11/11 o José pediu para só religar no dia 29. A cobrança volta sozinha nessa data.',
         updated_at = now()
   WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não achei a cliente da pausa (CARLA CRISTINA CORREA AMORIM PEDROSO).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers
                  WHERE id = v_id AND dunning_paused
                    AND dunning_paused_until = DATE '2026-11-29') THEN
    RAISE EXCEPTION 'A pausa da Carla não ficou como devia.';
  END IF;
END
$carla$;
