-- Contador de visitas da vitrine, no proprio banco da loja.
--
-- Privacidade: nao grava IP, nao grava o navegador, nao grava a query string
-- (que pode levar busca da cliente) e nao usa cookie. A "visita" e uma chave
-- aleatoria que vive em sessionStorage: morre quando a aba fecha. Por isso da
-- para contar visitas de um dia sem seguir ninguem de um dia para o outro.

CREATE TABLE IF NOT EXISTS public.store_visits (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  visit_key     text        NOT NULL,
  path          text        NOT NULL,
  referrer_host text,
  is_mobile     boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS store_visits_created_at_idx ON public.store_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS store_visits_visit_key_idx  ON public.store_visits (visit_key, created_at DESC);

-- Ninguem toca na tabela direto: so pelas funcoes abaixo.
ALTER TABLE public.store_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_visits FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.store_visits_id_seq FROM anon, authenticated;

-- ---------------------------------------------------------------- registrar
CREATE OR REPLACE FUNCTION public.store_registrar_visita(
  p_visit_key     text,
  p_path          text,
  p_referrer_host text DEFAULT NULL,
  p_is_mobile     boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path  text;
  v_quant integer;
BEGIN
  -- Entrada malformada nao vira linha; a vitrine nunca ve erro por isso.
  IF p_visit_key IS NULL OR length(p_visit_key) < 8 OR length(p_visit_key) > 64 THEN
    RETURN;
  END IF;

  v_path := left(split_part(coalesce(p_path, ''), '?', 1), 200);
  IF v_path = '' OR left(v_path, 1) <> '/' THEN
    RETURN;
  END IF;

  -- Trava contra enxurrada: uma mesma visita nao grava mais que 100 paginas
  -- por hora. Cliente nenhuma navega assim; robo e script, sim.
  SELECT count(*) INTO v_quant
    FROM public.store_visits
   WHERE visit_key = p_visit_key
     AND created_at > now() - interval '1 hour';
  IF v_quant >= 100 THEN
    RETURN;
  END IF;

  INSERT INTO public.store_visits (visit_key, path, referrer_host, is_mobile)
  VALUES (
    left(p_visit_key, 64),
    v_path,
    nullif(left(coalesce(p_referrer_host, ''), 120), ''),
    coalesce(p_is_mobile, false)
  );
END
$$;

REVOKE ALL ON FUNCTION public.store_registrar_visita(text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.store_registrar_visita(text, text, text, boolean) TO anon, authenticated;

-- ------------------------------------------------------------------ relatorio
-- Dia a dia, no fuso de Sao Paulo, para a tela de Pedidos da Loja.
CREATE OR REPLACE FUNCTION public.store_visitas_por_dia(p_dias integer DEFAULT 14)
RETURNS TABLE (dia date, visitas bigint, paginas bigint, celular bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
         count(DISTINCT visit_key)                           AS visitas,
         count(*)                                            AS paginas,
         count(DISTINCT visit_key) FILTER (WHERE is_mobile)  AS celular
    FROM public.store_visits
   WHERE created_at >= now() - (greatest(least(coalesce(p_dias, 14), 90), 1) || ' days')::interval
   GROUP BY 1
   ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.store_visitas_por_dia(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.store_visitas_por_dia(integer) TO authenticated;

-- As paginas mais vistas no periodo.
CREATE OR REPLACE FUNCTION public.store_visitas_por_pagina(p_dias integer DEFAULT 7)
RETURNS TABLE (path text, paginas bigint, visitas bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT path,
         count(*)                   AS paginas,
         count(DISTINCT visit_key)  AS visitas
    FROM public.store_visits
   WHERE created_at >= now() - (greatest(least(coalesce(p_dias, 7), 90), 1) || ' days')::interval
   GROUP BY 1
   ORDER BY 2 DESC
   LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.store_visitas_por_pagina(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.store_visitas_por_pagina(integer) TO authenticated;
