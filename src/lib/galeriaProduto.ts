import { MAX_FOTOS_DA_PECA, type ProductPhotos } from "../../supabase/functions/_shared/product-gallery";
export { MAX_FOTOS_DA_PECA, galeriaComNovaCapa } from "../../supabase/functions/_shared/product-gallery";

/** A capa vigente vem primeiro; uma galeria sem ela é uma galeria substituída. */
export function galeriaDoEditor(peca: ProductPhotos): string[] {
  const galeria = [...new Set((peca.images ?? []).filter(Boolean))];
  const capa = peca.image_url || null;
  if (!capa) return galeria.slice(0, MAX_FOTOS_DA_PECA);
  if (!galeria.includes(capa)) return [capa];
  return [capa, ...galeria.filter((foto) => foto !== capa)].slice(0, MAX_FOTOS_DA_PECA);
}
