-- Tira da SAIA VILMA a foto que subiu vazia.
--
-- Em 12/11/2026, às 08:25, a foto da SAIA VILMA subiu com 0 byte
-- (product-images/1794482756125_fqx5zgj3gui.jpeg). O arquivo ficou gravado, a
-- URL respondia HTTP 200 com content-type image/jpeg, e por isso a peça passou
-- pelo filtro da vitrine — que só exige que exista uma foto. Resultado: card
-- preto na loja, com o nome e o preço e nenhuma imagem.
--
-- A trava para não acontecer de novo está no código (src/lib/fotoEnviada.ts,
-- commit f80badd). Aqui some o estrago que já estava feito.
--
-- O QUE MUDA. A referência à foto vazia sai da capa e da galeria da peça.
--
-- E aí vem a boa notícia que só apareceu ao conferir: a variação GG · TERRACOTA
-- tem uma foto própria, de 192 KB, essa sim inteira. Como store_catalog() lê
-- COALESCE(image_url, images[1], foto da variação com estoque), tirar a capa
-- vazia faz a vitrine cair na foto da variação — a SAIA VILMA **continua na
-- loja**, agora com imagem de verdade. Se um dia a peça ficar sem nenhuma foto
-- boa, ela simplesmente sai da vitrine, que também está certo.
--
-- Nada mais é tocado: preço, estoque e a chave "Mostrar na loja" ficam como
-- estão.
--
-- Autorizado pelo José em 12/11/2026.
DO $vazia$
DECLARE
  v_arquivo text := '1794482756125_fqx5zgj3gui.jpeg';
  v_bytes   bigint;
  v_usos    int;
  v_prod    uuid;
  v_nome    text;
  v_sobrou  int;
  v_vitrine text;
  v_bytes_vitrine bigint;
BEGIN
  -- 1. é mesmo o arquivo vazio?
  SELECT coalesce((o.metadata->>'size')::bigint, -1) INTO v_bytes
    FROM storage.objects o
   WHERE o.bucket_id = 'product-images' AND o.name = v_arquivo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não achei o arquivo % no bucket product-images.', v_arquivo;
  END IF;

  IF v_bytes <> 0 THEN
    RAISE EXCEPTION 'O arquivo % tem % bytes — não é o vazio. Não apago nada.', v_arquivo, v_bytes;
  END IF;

  -- 2. quem usa esse arquivo
  SELECT count(*) INTO v_usos
    FROM products p
   WHERE p.image_url LIKE '%' || v_arquivo
      OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo);

  IF v_usos <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 peça usando a foto vazia e achei % — confira antes.', v_usos;
  END IF;

  SELECT p.id, p.name INTO v_prod, v_nome
    FROM products p
   WHERE p.image_url LIKE '%' || v_arquivo
      OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo);

  IF v_nome NOT ILIKE '%VILMA%' THEN
    RAISE EXCEPTION 'A foto vazia está na peça "%", que não é a SAIA VILMA. Parei.', v_nome;
  END IF;

  IF EXISTS (SELECT 1 FROM product_variants v
              WHERE v.image_url LIKE '%' || v_arquivo) THEN
    RAISE EXCEPTION 'A foto vazia também está numa variação — não previsto, parei.';
  END IF;

  -- 3. tira a referência
  UPDATE products
     SET image_url = CASE WHEN image_url LIKE '%' || v_arquivo THEN NULL ELSE image_url END,
         images = coalesce((SELECT array_agg(img ORDER BY ord)
                              FROM unnest(images) WITH ORDINALITY AS t(img, ord)
                             WHERE img NOT LIKE '%' || v_arquivo), '{}'::text[]),
         updated_at = now()
   WHERE id = v_prod;

  -- 4. o arquivo em si sai pela tela de Storage, não daqui
  --
  -- O banco recusa DELETE direto em storage.objects: o gatilho
  -- storage.protect_delete() responde "Direct deletion from storage tables is
  -- not allowed. Use the Storage API instead." — e com razão, porque apagar a
  -- linha deixaria o arquivo órfão no bucket de verdade. A primeira versão
  -- desta migração tentou e foi recusada; como todo o bloco é atômico, nada
  -- chegou a ser aplicado. O arquivo vazio foi removido na mão, pelo painel
  -- (Mais → Storage → product-images), em 12/11/2026.
  --
  -- Mesmo que ele fique no bucket, não faz mal: tem 0 byte e, depois do passo
  -- 3, nenhuma peça aponta para ele.

  -- 5. conferências
  IF EXISTS (SELECT 1 FROM products p
              WHERE p.id = v_prod
                AND (p.image_url LIKE '%' || v_arquivo
                  OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || v_arquivo))) THEN
    RAISE EXCEPTION 'A referência da foto vazia continua na peça.';
  END IF;

  -- a foto que a vitrine vai mostrar não pode ser vazia
  SELECT c.image_url INTO v_vitrine FROM store_catalog() c WHERE c.id = v_prod;

  IF v_vitrine IS NOT NULL THEN
    IF v_vitrine LIKE '%' || v_arquivo THEN
      RAISE EXCEPTION 'A vitrine ainda está mostrando a foto vazia.';
    END IF;

    SELECT coalesce((o.metadata->>'size')::bigint, -1) INTO v_bytes_vitrine
      FROM storage.objects o
     WHERE o.bucket_id = 'product-images' AND v_vitrine LIKE '%' || o.name;

    IF coalesce(v_bytes_vitrine, 0) <= 0 THEN
      RAISE EXCEPTION 'A foto que a vitrine vai mostrar tem % bytes.', coalesce(v_bytes_vitrine, 0);
    END IF;

    RAISE NOTICE 'A peça segue na vitrine, agora com a foto de % bytes.', v_bytes_vitrine;
  ELSE
    RAISE NOTICE 'A peça saiu da vitrine: não sobrou nenhuma foto. Sobe a foto nova pelo Estoque.';
  END IF;

  -- nenhuma outra peça pode estar usando foto vazia
  SELECT count(*) INTO v_sobrou
    FROM products p
    JOIN storage.objects o
      ON o.bucket_id = 'product-images'
     AND coalesce((o.metadata->>'size')::bigint, 0) = 0
     AND (p.image_url LIKE '%' || o.name
       OR EXISTS (SELECT 1 FROM unnest(p.images) img WHERE img LIKE '%' || o.name));

  IF v_sobrou > 0 THEN
    RAISE EXCEPTION 'Ainda há % peça(s) apontando para foto vazia.', v_sobrou;
  END IF;

  RAISE NOTICE 'Foto vazia removida de "%". A peça sai da vitrine até a foto nova subir.', v_nome;
END
$vazia$;
