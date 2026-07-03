## Conferência da planilha `clientes.xlsx`

Aba usada: **Lançamentos** (203 linhas → 201 únicos após dedupe por nome+CPF).

Cruzei com os **286 clientes** já cadastrados no banco usando duas chaves:
1. **CPF/CNPJ** (só dígitos) — match exato.
2. **Nome normalizado** (sem acento/caixa) — match exato, prefixo ou substring (a partir de 10 caracteres) para tolerar nomes truncados da planilha (ex.: `APARECIDA PAIX` → `APARECIDA PAIXAO DOS SANTOS`).

**Resultado:** 121 já existem, **80 estão faltando**.

## O que vou fazer

Inserir os 80 clientes ausentes na tabela `customers` com:
- `name` = como está na planilha (nomes truncados como `ALINE AZEVEDO SANTOS VIEI` ficam assim; você pode editar depois em `/clientes`).
- `tax_id` = só dígitos, quando a planilha traz.
- Demais campos ficam vazios.

Casos especiais tratados:
- `THAMIRIS SOUZA NASCIMENTO 40630308810` (CNPJ `40830089000138`) entra como um segundo cadastro em nome dela — a planilha traz as duas linhas.
- `BEATRIZ MELO DA SILVA` aparece duas vezes na planilha (uma com CPF, uma sem). Insiro só a versão com CPF.
- `MARIA MYLLENA VIANA MOREIRA` e `MARIA MYLLENA VIANA NASCIMENTO` compartilham o mesmo CPF `05445142388` — mantenho as duas grafias como registros separados, pois foi assim que a planilha entregou; se preferir mesclar, me avise depois.

## Amostra dos que serão inseridos

ALDER LINS DE MELO · ALINE AZEVEDO SANTOS VIEI · ANA VAGNA RANGEL SILVA · ANNE DE SOUSA ARAÚJO (539.137.698-03) · BARBARA RAIANE SILVA VERI · BEATRIZ MELO DA SILVA (462.858.858-93) · BRUNA SILVA GONCALVES (358.617.408-01) · CARLOS EDUARDO RODRIGUES (133.154.148-40) · CIBELE SANTOS CAMPELO (424.558.368-19) · CLEIDE APARECIDA OLIVEIRA · … (e mais 70).

Nenhum outro dado do sistema é alterado.
