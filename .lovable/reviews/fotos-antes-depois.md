# Fase 2 — proposta para os oito produtos, ainda não executada

Consulta somente de leitura em 21/11/2026. Nenhum produto foi alterado.
Os nomes abaixo identificam os arquivos das fotos, sem expor o endereço interno do armazenamento.
As letras A, B, C e D valem apenas dentro de cada produto; a ordem da galeria está indicada explicitamente.

## 1. Blazer 6917 Karina — código 06917
- **A:** `romaneio/06917_1790021265392.jpg` — capa antiga indicada no relatório anterior.
- **B:** `1794667028250_jt4a7o7lva.png` — foto nova indicada no relatório anterior.
- **Antes:** capa **A**; galeria **[A, B]**.
- **Depois proposto:** capa **B**; galeria **[B]**.

## 2. Blazer Rebeca — código 06373
- **A:** `1793315542680_2osa33o4n2q.jpeg` — capa antiga indicada no relatório anterior.
- **B:** `1794582722050_nf0yyb3wmjc.png` — foto nova indicada no relatório anterior.
- **Antes:** capa **A**; galeria **[A, B]**.
- **Depois proposto:** capa **B**; galeria **[B]**.

## 3. Blusa 6261 Carmen — código 06261
- **A:** `1794594073318_irr786va1ne.jpg` — capa atual.
- **B:** `romaneio/06261_1782950340901.jpg` — foto antiga indicada no relatório anterior.
- **Antes:** capa **A**; galeria **[A, B]**.
- **Depois proposto:** capa **A**; galeria **[A]**.

## 4. Vestido Eva — código 062116
- **A:** `1794593535109_8y2jd8p77n8.png` — capa atual.
- **B:** `1794593534444_sfvxb0ya7f9.png` — foto adicional preservada.
- **C:** `romaneio/062116_1782951437458.jpg` — foto antiga indicada no relatório anterior.
- **D:** `1794593535679_nc187izsuds.png` — foto adicional preservada.
- **Antes:** capa **A**; galeria **[A, B, C, D]**.
- **Depois proposto:** capa **A**; galeria **[A, B, D]**.

## 5. Saia 7125 Flora — código 07125
- **A:** `1794594905444_hsfo0py3aad.png` — capa atual.
- **B:** `1793318678692_s0awfjbjd2c.png` — foto antiga indicada no relatório anterior.
- **Antes:** capa **A**; galeria **[A, B]**.
- **Depois proposto:** capa **A**; galeria **[A]**.

## 6. Saia Secr. Mont. Telma — código 00178
- **A:** `1794605391717_vyp5pzbageh.jpg` — capa atual.
- **B:** `1794583844946_laov59s8m9.jpg` — foto antiga indicada no relatório anterior.
- **Antes:** capa **A**; galeria **[A, B]**.
- **Depois proposto:** capa **A**; galeria **[A]**.

## 7. Saia Izabel — código 06274.009
- **A:** `1794594986511_pyxhgcbvhih.jpg` — capa atual.
- **B:** `1794594711229_i3ks63t6u2.jpeg` — foto intermediária antiga indicada no relatório anterior.
- **C:** `1794594987281_2s6cs1dsaue.jpg` — foto adicional preservada.
- **Antes:** capa **A**; galeria **[A, B, C]**.
- **Depois proposto:** capa **A**; galeria **[A, C]**.

## 8. Camisa Curta no Pied de Poule Adriely — sem código
- **A:** `1794670525694_8zkrjac3zvo.jpg` — capa atual.
- **B:** `1794665826633_1i74vmy31ek.png` — foto intermediária antiga indicada no relatório anterior.
- **C:** `1794670526564_ve7dz179z2d.jpg` — foto adicional preservada.
- **Antes:** capa **A**; galeria **[A, B, C]**.
- **Depois proposto:** capa **A**; galeria **[A, C]**.

## Limites do ajuste proposto
Somente trocar os dois Blazers para a foto nova já existente e remover as oito fotos antigas indicadas, preservando as demais fotos e sua ordem. Não apagar arquivos de fotos do armazenamento; não alterar variações, preços, quantidades, vendas ou outros produtos. As classificações de foto antiga/nova vêm do relatório anterior e são propostas para sua confirmação, não um histórico de alterações comprovado pelo banco.

A consulta atual mostrou fotos adicionais no Vestido Eva, na Saia Izabel e na Camisa Adriely; todas foram incluídas no antes/depois e serão preservadas. O ajuste da fase 2 fica pendente da sua aprovação, sem execução nesta etapa.

## Fase 1 — código preparado, sem publicação
- `src/components/SupplierImageSearch.tsx`: o envio de foto pelo buscador lê a capa e a galeria atuais e grava as duas juntas; se a leitura falhar, não sobrescreve a galeria.
- `supabase/functions/find-product-image/index.ts`: a foto escolhida na busca recebe o mesmo tratamento, sem mudar as regras das variações.
- `supabase/functions/_shared/product-gallery.ts`: regra única usada nos dois caminhos; zero ou uma foto é substituída pela nova; com detalhes, a nova vem primeiro e a capa substituída sai.
- `src/lib/galeriaProduto.ts`: a abertura da edição coloca a capa vigente primeiro; só preserva outras fotos quando a capa ainda está na galeria. Sem a capa vigente na galeria, abre somente a capa, conforme autorizado.
- Testes: **21 aprovados em três arquivos**, cobrindo os dois caminhos de gravação, erros de leitura, limite de oito fotos, fotos duplicadas e reabertura da edição. A prévia está sem erros de compilação.
- Os testes usam dados simulados, sem gravar no banco nem no armazenamento. O recurso opcional `canvas`, indisponível no ambiente, foi desativado apenas durante a execução dos testes, sem alterar dependências ou configuração.
- Não houve teste de gravação em produto real, para respeitar sua proibição de alterar dados. Nenhuma tela adicional, migração, variação, venda, quantidade de estoque ou produto foi alterado. `AGENTS.md` e `roadmap.md` apenas registram a regra técnica e a pendência de aprovação.
- **Nada foi publicado, nem o app nem a função**; o site e a função em produção continuam na versão anterior até sua publicação.