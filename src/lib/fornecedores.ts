/**
 * Nome de fornecedor: comparação que ignora o jeito de escrever.
 *
 * O campo é texto livre, e o mesmo fornecedor entrou no estoque de várias
 * formas — "TATA MARTELLO", "Tatá Martello" e "TATAMARTELLO" são a mesma
 * pessoa. Cada grafia virava um fornecedor diferente no filtro do Estoque e
 * quebrava o total comprado de cada um.
 *
 * A chave joga fora o que é só jeito de escrever: acento, maiúscula,
 * pontuação e espaço. Ela NÃO tenta adivinhar nome parecido: "HELP CHIC" e
 * "HELP CHIK" continuam diferentes aqui, porque juntar dois fornecedores de
 * verdade é pior do que deixar dois nomes na lista — isso é decisão de quem
 * compra, não do sistema.
 */
export function chaveDoFornecedor(nome: string | null | undefined): string {
  return (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Dois nomes são o mesmo fornecedor escrito diferente? */
export function mesmoFornecedor(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chaveDoFornecedor(a);
  return ka !== "" && ka === chaveDoFornecedor(b);
}

/**
 * O nome que está sendo digitado já existe no cadastro com outra grafia?
 *
 * Devolve o nome já cadastrado, para a tela oferecer "usar este". Se o que foi
 * digitado for idêntico ao que existe, não há nada a avisar.
 */
export function fornecedorJaCadastrado(
  digitado: string | null | undefined,
  cadastrados: readonly string[],
): string | null {
  const texto = (digitado ?? "").trim();
  if (texto.length < 2) return null;
  const achado = cadastrados.find((c) => mesmoFornecedor(c, texto));
  return achado && achado !== texto ? achado : null;
}
