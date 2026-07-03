## Tela de Conciliação de Clientes

Adiciona uma nova aba **"Conciliação"** na página `/clientes` que lista pares de cadastros suspeitos de serem o mesmo cliente e permite mesclar com um clique.

### Regras de detecção
1. **Mesmo CPF/CNPJ** (só dígitos). Match forte.
2. **Nome truncado é prefixo de outro** (≥10 caracteres, sem acento/caixa). Ex.: `APARECIDA PAIX` ↔ `APARECIDA PAIXAO DOS SANTOS`.

Também mostro no relatório os **2 duplicados exatos** já detectados (`GUILHERME OMAR PARLETTA`, `RUTH DA SILVA LUCAS PINTO`) como caso da regra 2 (prefixo = nome inteiro).

### UI (nova aba na página Clientes)
Cada par suspeito aparece como um card:

```
┌─────────────────────────────────────────────────────────────┐
│  Possível duplicidade — motivo: nome truncado                │
│                                                              │
│  [ ] Manter                    [ ] Manter (canônico)         │
│  APARECIDA PAIX                APARECIDA PAIXAO DOS SANTOS   │
│  Apelido: —                    Apelido: CIDA VILMA           │
│  CPF: —                        CPF: —                        │
│  Vendas: 0 · Receber: 0        Vendas: 3 · Receber: R$ 240   │
│                                                              │
│                        [ Mesclar ]   [ Ignorar ]             │
└─────────────────────────────────────────────────────────────┘
```

- O lado marcado como **canônico** é sugerido automaticamente (o que tem mais dados: apelido, CPF, vendas, receber). Você pode inverter antes de mesclar.
- **Mesclar** transfere para o canônico:
  - `sales.customer_id`
  - `accounts_receivable.customer_id`
  - Preenche no canônico os campos que estiverem vazios (apelido, CPF, telefone, email, endereço, notas) usando o valor do duplicado.
  - Apaga o registro duplicado.
- **Ignorar** guarda um par ignorado (nova tabela `customer_merge_ignored` com os dois ids) para não voltar a aparecer.

### Backend
- Nova tabela `customer_merge_ignored (customer_a_id, customer_b_id)` com RLS para `authenticated`.
- Nova Edge Function `merge-customers` que recebe `{ keep_id, drop_id }`, roda as atualizações em transação e devolve contagem de linhas migradas. Usa `service_role` para garantir consistência mesmo com RLS.
- A listagem dos pares é feita no cliente: busca todos os clientes uma vez e aplica as duas regras em memória (356 registros → trivial).

### Arquivos afetados
- `src/pages/Customers.tsx` — adicionar `<Tabs>` com "Lista" (atual) e "Conciliação" (nova).
- `src/components/customers/Reconciliation.tsx` — nova, contém a lógica de detecção e os cards.
- `supabase/functions/merge-customers/index.ts` — nova edge function.
- Migration: cria `customer_merge_ignored` com RLS/GRANTs.

### Fora do escopo
- Não uso apelido↔nome como regra de match agora (você deixou de fora). Se depois quiser adicionar, é só uma linha na detecção.
- Não altero a página `/clientes` além de introduzir as abas.
