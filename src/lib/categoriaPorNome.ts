import { GARMENT_TYPES, type GarmentType } from "./garments";

/**
 * Adivinha a categoria da peça pelo que está escrito no nome (e, se precisar,
 * na descrição).
 *
 * O cadastro tinha dois campos dizendo a mesma coisa: `category`, texto livre,
 * quase sempre em branco, e `garment_type`, a lista fechada que monta os
 * filtros da vitrine e diz ao provador com IA que parte do corpo a peça veste.
 * Na prática o nome da peça já carrega a resposta — "SAIA SECR.MONT.TELMA" é
 * saia — e preencher à mão só fazia a peça ficar sem categoria e sumir dos
 * filtros da loja.
 *
 * A regra é de propósito conservadora: quando nenhuma palavra conhecida
 * aparece, devolve `null` e o campo fica em branco esperando o operador. Chute
 * errado é pior que campo vazio — manda a peça para a prateleira errada da loja
 * e faz o provador vestir uma saia no lugar de uma blusa.
 *
 * Medida contra o estoque real em 13/11/2026: das 564 peças já classificadas à
 * mão, acertou 554 e discordou de nenhuma; nas 10 restantes não opinou.
 */

/** Ordem importa: a primeira regra que casar vence. */
const REGRAS: ReadonlyArray<readonly [RegExp, GarmentType]> = [
  // Peça inteira primeiro: "CONJUNTO SAIA E BLUSA" é conjunto, não saia.
  [/\b(CONJUNTO|CONJ|MACACAO|MACAQUINHO|JARDINEIRA)\b/, "conjunto"],
  [/\b(VESTIDO|VEST|CHEMISE|CHEMISSIE|TUBINHO|TUB|CAMISOLA)\b/, "vestido"],
  [/\b(SAIA|SAIAS|SAI)\b/, "saia"],
  [/\b(CALCA|CALCAS|LEGGING|PANTALONA|SHORT|SHORTS|BERMUDA)\b/, "calca"],
  [
    /\b(BLUSA|BLUSAS|BL|CAMISA|CAMISETA|BLAZER|CROPPED|BODY|REGATA|CASACO|JAQUETA|COLETE|TRICOT|CARDIGA|CARDIGAN|TOP|KIMONO|PARKA|SUETER|MOLETOM|MOLETINHO|SOBRETUDO|TRENCH|PEPLUM)\b/,
    "blusa",
  ],
  [/\b(BOLSA|CINTO|BRINCO|COLAR|LENCO|ECHARPE|CACHECOL|MEIA|CHAPEU|OCULOS|PULSEIRA|CARTEIRA)\b/, "outro"],
];

/** Tira acento e troca pontuação por espaço: "SECR.MONT" vira "SECR MONT". */
const normalizar = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");

export function categoriaSugerida(nome?: string | null, descricao?: string | null): GarmentType | null {
  const texto = normalizar(`${nome ?? ""} ${descricao ?? ""}`);
  if (!texto.trim()) return null;
  for (const [padrao, categoria] of REGRAS) if (padrao.test(texto)) return categoria;
  return null;
}

/** A sugestão só vale se a peça ainda não tiver categoria escolhida. */
export function categoriaDoCadastro(p: {
  name?: string | null;
  description?: string | null;
  garment_type?: string | null;
}): GarmentType | "" {
  const atual = p.garment_type ?? "";
  if ((GARMENT_TYPES as readonly string[]).includes(atual)) return atual as GarmentType;
  return categoriaSugerida(p.name, p.description) ?? "";
}
