export const MAX_FOTOS_DA_PECA = 8;

export interface ProductPhotos {
  images?: string[] | null;
  image_url?: string | null;
}

/** Replace the previous cover, retaining only the other detail photos. */
export function galeriaComNovaCapa(peca: ProductPhotos, novaCapa: string): string[] {
  const galeria = [...new Set((peca.images ?? []).filter(Boolean))];
  if (galeria.length <= 1) return [novaCapa];
  return [novaCapa, ...galeria.filter((foto) => foto !== peca.image_url && foto !== novaCapa)]
    .slice(0, MAX_FOTOS_DA_PECA);
}