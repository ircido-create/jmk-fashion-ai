
## Problema

A Mônica disse à Francieli que não há parcelas em atraso, mas existe R$ 210 em aberto. A causa é dupla:

1. **Duplicidade de cadastro** com o mesmo telefone em formatos diferentes:
   - `Francieli` — telefone `5511982303541` (sem dívidas)
   - `FRANCIELI GOMES DA SILVA FAVERE` — telefone `+55 11 98230-3541` (R$ 210 em aberto)

2. **Lookup frágil por telefone**. Em `supabase/functions/_shared/monica-core.ts` (`buildContext`) e em `supabase/functions/bubblewhats-webhook/index.ts` (fast-path da "ficha") o SQL usa `.in("phone", variantsArr)` com **somente dígitos**. Como o cadastro que tem a dívida está gravado como `+55 11 98230-3541`, ele nunca casa — a IA só enxerga o cadastro "limpo" (0 dívidas) e responde "nenhuma parcela".

## Correção

### 1. Lookup por dígitos (comparar sem formatação) — corrige o bug para todos os clientes

Trocar o `.in("phone", variantsArr)` por comparação normalizada por dígitos, em dois lugares:

- `supabase/functions/_shared/monica-core.ts` → função `buildContext` (por volta da linha 911).
- `supabase/functions/bubblewhats-webhook/index.ts` → fast-path da "ficha" (por volta da linha 360, onde busca `customers` pelo telefone).

Estratégia: usar `regexp_replace(phone, '\\D', '', 'g')` no lado do banco via `.or()` com padrões `phone.eq.<variante>` OU consultar via RPC. Como não temos RPC pronto e o volume é pequeno, adotamos:

```ts
// gera variantes de dígitos
const digits = (phone ?? "").replace(/\D/g, "");
const variants = new Set<string>([digits]);
if (digits.startsWith("55")) variants.add(digits.slice(2));
else if (digits.length >= 10) variants.add("55" + digits);
const variantsArr = Array.from(variants).filter(Boolean);

// busca ampla + filtro em memória por dígitos
const orExpr = variantsArr.map(v => `phone.ilike.%${v}%`).join(",");
const { data: rows } = await supabase
  .from("customers")
  .select("id, name, nickname, address, email, phone")
  .or(orExpr);

const matchedCustomers = (rows ?? []).filter(c => {
  const d = (c.phone ?? "").replace(/\D/g, "");
  return variantsArr.some(v => d === v || d.endsWith(v) || v.endsWith(d));
});
```

Isso captura tanto `5511982303541` quanto `+55 11 98230-3541` (e variações com/sem 55).

Aplicar o mesmo padrão no fast-path "ficha" do webhook, mantendo o restante da lógica (busca `accounts_receivable` por `customer_id IN (...)`, `.neq("status","pago")`, cálculo de saldo com `receivable_payments.amount_paid`).

### 2. Mesclar a duplicata da Francieli (dado)

Executar migration SQL:
- Reatribuir `accounts_receivable.customer_id`, `sales.customer_id`, `pre_sales.customer_id`, `payment_proofs.customer_id`, `whatsapp_conversations.customer_id`, `receivable_payments` (via receivable), `accounts_receivable` e `dunning_logs.customer_id` do id `4262347a-…` (Francieli) para `fb979fd5-…` (FRANCIELI GOMES…).
- Normalizar o telefone do cadastro que fica para apenas dígitos: `UPDATE customers SET phone='5511982303541' WHERE id='fb979fd5-…'`.
- Deletar o cadastro vazio `4262347a-…`.

### 3. (Opcional, mesma migration) Normalizar todos os telefones

`UPDATE public.customers SET phone = regexp_replace(phone, '\D', '', 'g') WHERE phone ~ '\D';`
Isso evita que o problema volte com outros clientes. Ficam apenas dígitos no cadastro; o lookup por dígitos continua funcionando.

## Detalhes técnicos

- **Arquivos alterados**:
  - `supabase/functions/_shared/monica-core.ts` (`buildContext`)
  - `supabase/functions/bubblewhats-webhook/index.ts` (fast-path "ficha")
  - nova migration SQL para mesclar Francieli e normalizar telefones
- **Sem alteração de UI**. Sem alteração de prompt.
- **Risco**: normalizar todos os telefones é uma operação global — mitigado porque hoje já pesquisamos por dígitos em outros lugares (POS, Receivable) e o app envia via BubbleWhats usando dígitos.

## Validação

- Rodar SQL: garantir que restou 1 Francieli com `phone='5511982303541'` e R$ 210 em aberto.
- Testar `buildContext` do webhook simulando telefone `5511982303541`: `ctx.debts.length` deve ser 1.
- Enviar "ficha" pela conversa da Francieli e conferir a resposta com R$ 210 e vencimento.
