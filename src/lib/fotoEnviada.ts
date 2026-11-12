/**
 * Confere a foto escolhida antes de subir para o storage.
 *
 * O caso que fez esta função existir: em 12/11/2026 a foto da SAIA VILMA subiu
 * com 0 byte. O arquivo ficou gravado no bucket, a peça entrou na vitrine com a
 * URL salva — porque a loja só exige que exista uma foto — e o card apareceu
 * preto na loja virtual. Arquivo vazio acontece quando a foto ainda está só na
 * nuvem (OneDrive, Google Fotos, iCloud) e o aparelho entrega o atalho em vez
 * da imagem, ou quando a cópia foi interrompida no meio.
 *
 * Antes daqui, as telas conferiam só o tipo e o tamanho máximo: 0 byte passava
 * nos dois.
 */
export const MAX_FOTO_BYTES = 5 * 1024 * 1024;

export function problemaNaFoto(file: File | Blob): string | null {
  const nome = file instanceof File && file.name ? `${file.name}: ` : "";
  if (file.type && !file.type.startsWith("image/")) return `${nome}não é uma imagem`;
  if (file.size === 0) {
    return `${nome}chegou vazia. A foto pode estar guardada só na nuvem — abra a imagem uma vez no aparelho para ela baixar, e escolha de novo.`;
  }
  if (file.size > MAX_FOTO_BYTES) return `${nome}maior que 5MB`;
  return null;
}
