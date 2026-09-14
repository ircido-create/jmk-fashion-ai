/**
 * Tipo de peça — compartilhado pelo cadastro (administrativo) e pela loja.
 *
 * Além de separar a vitrine, o tipo diz ao provador com IA qual parte do corpo
 * a peça veste: é isso que permite provar uma blusa e uma saia juntas. Os
 * valores espelham o CHECK de products.garment_type.
 */
export const GARMENT_TYPES = ["blusa", "saia", "calca", "vestido", "conjunto", "outro"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

export type BodyRegion = "upper" | "lower" | "full";

/** Rótulo do cadastro. */
export const GARMENT_LABEL: Record<GarmentType, string> = {
  blusa: "Blusa / Camisa",
  saia: "Saia",
  calca: "Calça",
  vestido: "Vestido",
  conjunto: "Conjunto (roupa inteira)",
  outro: "Outro (fora do provador)",
};

/** Rótulo da vitrine. */
export const GARMENT_PLURAL: Record<GarmentType, string> = {
  blusa: "Blusas & Camisas",
  saia: "Saias",
  calca: "Calças",
  vestido: "Vestidos",
  conjunto: "Conjuntos",
  outro: "Outros",
};

/** "Outro" fica de fora: acessório não tem como ser vestido pela IA. */
export const GARMENT_REGION: Partial<Record<GarmentType, BodyRegion>> = {
  blusa: "upper",
  saia: "lower",
  calca: "lower",
  vestido: "full",
  conjunto: "full",
};

export const REGION_LABEL: Record<BodyRegion, string> = {
  upper: "Parte de cima",
  lower: "Parte de baixo",
  full: "Vestido ou conjunto",
};

export const isGarmentType = (v: unknown): v is GarmentType =>
  typeof v === "string" && (GARMENT_TYPES as readonly string[]).includes(v);

export const regionOf = (t: string | null | undefined): BodyRegion | null =>
  isGarmentType(t) ? GARMENT_REGION[t] ?? null : null;
