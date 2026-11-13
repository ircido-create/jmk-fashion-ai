/**
 * Fotos que o editor do Estoque abre para uma peça, sem perder a capa.
 *
 * A capa (`image_url`) e a galeria (`images`) são campos separados da peça. O
 * buscador de foto do fornecedor — e o envio de foto por dentro dele — gravam
 * só a capa, direto no banco, sem tocar na galeria. Quando o editor montava a
 * galeria sozinha, salvar qualquer campo (até só o preço) regravava
 * `image_url = images[0]` e desfazia a foto nova: voltava a antiga no Estoque,
 * no PDV, no cupom e na loja.
 *
 * Então a capa que está valendo entra na frente sempre que ainda não estiver
 * na galeria. É a mesma ordem que a página da peça na loja já monta.
 */
export const MAX_FOTOS_DA_PECA = 8;

export function galeriaDoEditor(peca: {
  images?: string[] | null;
  image_url?: string | null;
}): string[] {
  const galeria = (peca.images ?? []).filter(Boolean);
  const capa = peca.image_url || null;
  if (!capa) return galeria;
  if (galeria.includes(capa)) return galeria;
  // O editor trabalha com no máximo 8 fotos: a capa entra e a última cai.
  return [capa, ...galeria].slice(0, MAX_FOTOS_DA_PECA);
}
