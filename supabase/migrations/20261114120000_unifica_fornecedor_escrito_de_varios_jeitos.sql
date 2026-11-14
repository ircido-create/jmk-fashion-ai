-- Junta o mesmo fornecedor escrito de várias formas em uma grafia só.
--
-- O campo é texto livre e o mesmo fornecedor entrou de jeitos diferentes:
-- "TATA MARTELLO" (96 peças), "Tatá Martello" (71) e "TATAMARTELLO" (2) são a
-- mesma pessoa, e viravam três fornecedores no filtro do Estoque, cada um com
-- seu total comprado.
--
-- Junta só o que é a mesma palavra escrita de outro jeito: acento, maiúscula,
-- pontuação e espaço. NÃO junta nome parecido — "HELP CHIC" e "HELP CHIK",
-- "Joyale" e "Joyaly", "Hapuk" e "Hapuk - Store" continuam separados, porque
-- juntar dois fornecedores de verdade é pior do que deixar dois nomes na
-- lista, e isso é decisão de quem compra. A mesma regra está em
-- src/lib/fornecedores.ts, que agora avisa na tela quando o nome digitado já
-- existe com outra grafia.
--
-- A grafia que fica é a mais usada no estoque; empate, a primeira em ordem
-- alfabética. Nenhuma peça troca de fornecedor: só muda como ele é escrito.

DO $forn$
DECLARE
  v_antes  int;
  v_mudou  int;
  v_depois int;
  v_esper  int;
BEGIN
  CREATE TEMP TABLE _chaves ON COMMIT DROP AS
    SELECT p.id,
           trim(p.supplier) AS nome,
           upper(regexp_replace(
             translate(p.supplier,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
             '[^A-Za-z0-9]', '', 'g')) AS chave
      FROM public.products p
     WHERE coalesce(trim(p.supplier), '') <> '';

  SELECT count(DISTINCT nome), count(DISTINCT chave) INTO v_antes, v_esper FROM _chaves;

  -- A grafia vencedora de cada fornecedor: a que aparece em mais peças.
  CREATE TEMP TABLE _vencedor ON COMMIT DROP AS
    SELECT DISTINCT ON (chave) chave, nome
      FROM (SELECT chave, nome, count(*) AS n FROM _chaves GROUP BY chave, nome) f
     ORDER BY chave, n DESC, nome;

  UPDATE public.products p
     SET supplier = v.nome
    FROM _chaves c
    JOIN _vencedor v ON v.chave = c.chave
   WHERE p.id = c.id
     AND p.supplier IS DISTINCT FROM v.nome;

  GET DIAGNOSTICS v_mudou = ROW_COUNT;

  SELECT count(DISTINCT trim(supplier)) INTO v_depois
    FROM public.products WHERE coalesce(trim(supplier), '') <> '';

  -- Depois da limpeza tem de sobrar exatamente um nome por fornecedor.
  IF v_depois <> v_esper THEN
    RAISE EXCEPTION 'Contas não fecham: % grafias antes, esperado % depois, deu %',
      v_antes, v_esper, v_depois;
  END IF;

  -- Nenhuma peça pode ter ficado sem fornecedor por causa disto.
  IF EXISTS (SELECT 1 FROM _chaves c JOIN public.products p ON p.id = c.id
              WHERE coalesce(trim(p.supplier), '') = '') THEN
    RAISE EXCEPTION 'Alguma peça perdeu o fornecedor';
  END IF;

  RAISE NOTICE 'Fornecedores: % grafias viraram %; % peça(s) tiveram o nome ajustado',
    v_antes, v_depois, v_mudou;
END;
$forn$;
