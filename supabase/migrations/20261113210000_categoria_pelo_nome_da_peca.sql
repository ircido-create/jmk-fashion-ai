-- Preenche a categoria (products.garment_type) das peças que estão sem ela,
-- lendo o que já está escrito no nome.
--
-- O cadastro tinha dois campos para a mesma coisa: "Categoria", texto livre, e
-- "Tipo de peça", a lista fechada que monta os filtros da vitrine e diz ao
-- provador com IA que parte do corpo a peça veste. O texto livre estava em
-- branco em 644 das 675 peças ativas, e as 31 preenchidas repetiam o tipo
-- (VESTIDO, SAIA, CONJUNTO, BLUSA). A tela passou a ter um campo só, chamado
-- Categoria, que grava em garment_type e se preenche sozinho pelo nome.
--
-- Faltava o estoque que já estava cadastrado: 111 peças ativas sem categoria
-- nenhuma, que por isso não aparecem em filtro nenhum da loja.
--
-- A regra é a mesma de src/lib/categoriaPorNome.ts e é conservadora de
-- propósito: sem palavra conhecida, a peça fica em branco esperando o
-- operador. Chute errado manda a peça para a prateleira errada e faz o
-- provador vestir no lugar errado do corpo.
--
-- Mexe só em peça ativa que está com garment_type nulo: nada do que foi
-- escolhido à mão é tocado.

DO $categoria$
DECLARE
  v_antes  int;
  v_depois int;
  v_mudou  int;
BEGIN
  SELECT count(*) INTO v_antes
    FROM public.products WHERE active AND garment_type IS NULL;

  WITH texto AS (
    SELECT
      p.id,
      -- Sem acento, em maiúscula, e pontuação virando espaço para que
      -- "SAIA SECR.MONT.TELMA" tenha "SAIA" como palavra inteira.
      regexp_replace(
        upper(translate(
          coalesce(p.name, '') || ' ' || coalesce(p.description, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
        )),
        '[^A-Z0-9]+', ' ', 'g'
      ) AS t
    FROM public.products p
    WHERE p.active AND p.garment_type IS NULL
  ), palpite AS (
    SELECT
      id,
      CASE
        -- Peça inteira primeiro: "CONJUNTO SAIA E BLUSA" é conjunto.
        WHEN t ~ '\y(CONJUNTO|CONJ|MACACAO|MACAQUINHO|JARDINEIRA)\y'            THEN 'conjunto'
        WHEN t ~ '\y(VESTIDO|VEST|CHEMISE|CHEMISSIE|TUBINHO|TUB|CAMISOLA)\y'    THEN 'vestido'
        WHEN t ~ '\y(SAIA|SAIAS|SAI)\y'                                         THEN 'saia'
        WHEN t ~ '\y(CALCA|CALCAS|LEGGING|PANTALONA|SHORT|SHORTS|BERMUDA)\y'    THEN 'calca'
        WHEN t ~ '\y(BLUSA|BLUSAS|BL|CAMISA|CAMISETA|BLAZER|CROPPED|BODY|REGATA|CASACO|JAQUETA|COLETE|TRICOT|CARDIGA|CARDIGAN|TOP|KIMONO|PARKA|SUETER|MOLETOM|MOLETINHO|SOBRETUDO|TRENCH|PEPLUM)\y' THEN 'blusa'
        WHEN t ~ '\y(BOLSA|CINTO|BRINCO|COLAR|LENCO|ECHARPE|CACHECOL|MEIA|CHAPEU|OCULOS|PULSEIRA|CARTEIRA)\y' THEN 'outro'
        ELSE NULL
      END AS categoria
    FROM texto
  )
  UPDATE public.products p
     SET garment_type = g.categoria
    FROM palpite g
   WHERE p.id = g.id
     AND g.categoria IS NOT NULL
     AND p.garment_type IS NULL;   -- trava de segurança: nunca por cima do que já existe

  GET DIAGNOSTICS v_mudou = ROW_COUNT;

  SELECT count(*) INTO v_depois
    FROM public.products WHERE active AND garment_type IS NULL;

  IF v_mudou = 0 THEN
    RAISE EXCEPTION 'Nenhuma peça foi classificada — a regra não casou com nada, confira antes de seguir';
  END IF;

  IF v_depois <> v_antes - v_mudou THEN
    RAISE EXCEPTION 'Contas não fecham: antes % sem categoria, % classificadas, sobraram % (esperado %)',
      v_antes, v_mudou, v_depois, v_antes - v_mudou;
  END IF;

  -- Nenhuma peça pode ter saído com valor fora da lista que a loja entende.
  IF EXISTS (
    SELECT 1 FROM public.products
     WHERE garment_type IS NOT NULL
       AND garment_type NOT IN ('blusa','saia','calca','vestido','conjunto','outro')
  ) THEN
    RAISE EXCEPTION 'Alguma peça ficou com categoria fora da lista da loja';
  END IF;

  RAISE NOTICE 'Categoria preenchida em % peça(s); % ainda sem categoria (nome sem pista)', v_mudou, v_depois;
END;
$categoria$;
