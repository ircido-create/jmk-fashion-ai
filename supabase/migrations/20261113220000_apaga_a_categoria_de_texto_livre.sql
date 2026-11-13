-- Apaga o texto livre antigo de products.category.
--
-- O campo era o "Categoria" digitado à mão do cadastro. Ele foi aposentado
-- quando a tela passou a ter um campo só, que grava em garment_type e se
-- preenche pelo nome da peça (migração 20261113210000). Sobraram 33 peças com
-- o texto antigo, e o que estava escrito ali — BLUSA, CONJUNTO, SAIA, VESTIDO —
-- já está guardado em garment_type, agora em 663 peças em vez de 33.
--
-- A COLUNA FICA, vazia, de propósito. A função do WhatsApp (monica-core) ainda
-- pede essa coluna pelo nome quando procura uma peça para a cliente; derrubar
-- a coluna faria o pedido dela falhar e a IA pararia de responder até a função
-- ser republicada. Tirar a coluna é uma segunda etapa, junto com a mudança na
-- função — e com ela no ar antes.
--
-- Nada mais depende da coluna: nenhuma função, trigger, view ou índice do
-- banco a cita (conferido em 13/11/2026).

DO $limpa$
DECLARE
  v_antes int;
  v_mudou int;
  v_resta int;
BEGIN
  SELECT count(*) INTO v_antes
    FROM public.products WHERE coalesce(trim(category), '') <> '';

  IF v_antes = 0 THEN
    RAISE NOTICE 'Nada a apagar: o texto livre já estava vazio';
    RETURN;
  END IF;

  -- Trava: nenhuma peça pode perder o texto livre sem ter a categoria de
  -- verdade preenchida. Se houver alguma, nada é apagado.
  IF EXISTS (
    SELECT 1 FROM public.products
     WHERE coalesce(trim(category), '') <> ''
       AND garment_type IS NULL
  ) THEN
    RAISE EXCEPTION 'Há peça com texto livre e sem categoria na lista — classifique antes de apagar';
  END IF;

  UPDATE public.products SET category = NULL WHERE category IS NOT NULL;
  GET DIAGNOSTICS v_mudou = ROW_COUNT;

  SELECT count(*) INTO v_resta
    FROM public.products WHERE category IS NOT NULL;

  IF v_resta <> 0 THEN
    RAISE EXCEPTION 'Sobrou texto livre em % peça(s)', v_resta;
  END IF;

  RAISE NOTICE 'Texto livre apagado de % peça(s) (% tinham conteúdo)', v_mudou, v_antes;
END;
$limpa$;
