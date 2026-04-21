

## Diagnóstico e correção da divergência

### O que aconteceu

**1. Diferença de R$ 304,00 (PDF R$ 100.032,04 vs Sistema R$ 99.728,04)**

Três lançamentos do PDF **não foram importados** porque não tinham número de documento (Carteira), que era usado como chave única no import:

| Cliente | Vencimento | Status | Valor |
|---|---|---|---|
| RAQUEL RODRIGUES | 30/04/2026 | aberto | R$ 130,00 |
| RAQUEL RODRIGUES | 30/04/2026 | parcial | R$ 124,00 |
| ELLEN PATY ("RESTA") | 28/02/2026 | atrasada | R$ 50,00 |
| **Total** | | | **R$ 304,00** |

**2. "NEIA - LIVIA IGOR" e "LIVIA IGOR"**

Esses lançamentos **estão no sistema**, só foram vinculados a clientes com nomes diferentes:

- `NEIA - LIVIA IGOR` (3 lançamentos do pedido 6557) → vinculado ao cliente já existente **"Néia Irma Livia"** (fez match por similaridade)
- `LIVIA IGOR` (2 lançamentos do pedido 6665) → vinculado ao cliente **"LIVIA IGOR"** que **já existe** no cadastro

Ou seja, não há cliente faltando — o que pode confundir é que o sistema mostra o nome do cliente **cadastrado** (ex: "Néia Irma Livia") e não o nome **literal do PDF** ("NEIA - LIVIA IGOR").

### O que vou fazer

**1. Inserir os 3 lançamentos faltantes** (R$ 304,00)
- Cliente "RAQUEL RODRIGUES" → já existe, vinculo direto (2 lançamentos somando R$ 254,00)
- Cliente "ELLEN PATY" → verifico se existe; se não, crio
- Como não têm número de documento, uso descrição: `Bling RAQUEL RODRIGUES 30/04/2026 (aberto) - sem nº doc` etc., para evitar duplicatas se você reimportar

**2. Validar o total final**
Após inserir, o total na tela `/contas-receber` deve passar a ser exatamente **R$ 100.032,04**, batendo com o PDF.

**3. (Opcional) Mostrar o nome original do PDF**
Se quiser, posso adicionar na descrição do lançamento o nome literal que vem do PDF (ex: "NEIA - LIVIA IGOR" mesmo quando o cliente cadastrado é "Néia Irma Livia"), facilitando a conferência futura. Me avisa se quer essa parte também.

### Detalhes técnicos

- INSERT direto via tool de dados (sem migration, é apenas data) na tabela `accounts_receivable`
- 3 registros: status `pendente` (mantendo regra "atrasada/parcial/aberto = pendente"), `due_date` 2026-04-30 (Raquel) e 2026-02-28 (Ellen), `customer_id` resolvido por nome
- Se "ELLEN PATY" não existir em `customers`, INSERT do cliente antes
- Sem alterações de schema, sem código frontend

