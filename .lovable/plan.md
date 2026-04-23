

# Dar baixa em massa nas contas a receber + anexar comprovante do extrato

## O que vai acontecer

1. **Todas as 155 contas a receber pendentes** (R$ 43.899,90) serão marcadas como `pago`, com `paid_at = data atual`.
2. **O arquivo do extrato** (`Extrato_Lançamentos_1145_993315_23-04-2026-2.xlsx`) ficará anexado como **comprovante da baixa**, acessível na tela de Contas a Receber.
3. A partir de agora, **toda baixa individual ou em massa** poderá ter um documento anexado (PDF, foto, planilha) — útil para anexar comprovantes Pix, extratos bancários, recibos.

## Mudanças no banco

### Nova tabela: `payment_proofs`
Guarda os comprovantes anexados a baixas:
- `id`, `created_at`, `created_by`
- `storage_path` — caminho do arquivo no bucket
- `original_filename`, `mime_type`, `file_size`
- `description` — texto livre (ex: "Baixa em massa do extrato 23/04/2026")
- `payment_date` — data da baixa que esse comprovante representa

### Nova tabela: `receivable_payments`
Vincula contas a receber a um comprovante (relação muitos-para-muitos):
- `receivable_id` → `accounts_receivable.id`
- `proof_id` → `payment_proofs.id`
- `amount_paid` — valor efetivamente recebido naquela conta (preparando o terreno para o fluxo de "carteira" com saldo)

### Novo bucket de storage: `payment-proofs` (privado)
- RLS: staff (admin + vendedor) pode upload e ler; somente admin pode deletar.

## Fluxo de baixa em massa (executado agora)

1. Upload do arquivo `Extrato_Lançamentos_1145_993315_23-04-2026-2.xlsx` no bucket `payment-proofs`.
2. Cria 1 registro em `payment_proofs` apontando para esse arquivo, com descrição "Baixa em massa — extrato 23/04/2026".
3. Para cada uma das 155 contas pendentes:
   - `UPDATE accounts_receivable SET status='pago', paid_at=now()`
   - `INSERT INTO receivable_payments (receivable_id, proof_id, amount_paid=amount)`

## Mudanças na UI (`src/pages/Receivable.tsx`)

### Botão "Baixa em massa" (novo)
- Ao lado de "Nova" e "PDF" no header.
- Abre um modal: seleciona quais contas dar baixa (default: todas as filtradas atualmente em "A Receber"), permite anexar 1 arquivo, e confirma.

### Anexar comprovante na baixa individual
- O botão atual ✓ ("marcar como recebido") passa a abrir um modal pequeno com:
  - Valor recebido (default = valor da conta)
  - Anexar comprovante (opcional)
  - Botão "Confirmar baixa"

### Mostrar comprovantes anexados
- Cada conta paga ganha um ícone 📎 quando tem comprovante. Ao clicar, abre/baixa o arquivo via signed URL.

## O que NÃO está nesta tarefa

- Tela dedicada de "histórico de comprovantes" (lista todos os arquivos anexados). Pode ser feita depois.
- Lógica completa de "carteira" (pagou a mais/menos → cria saldo automaticamente). A coluna `amount_paid` em `receivable_payments` já prepara o terreno, mas o fluxo automatizado fica para depois.

## Arquivos afetados

- `supabase/migrations/` (nova migration: 2 tabelas + bucket + RLS)
- `src/pages/Receivable.tsx` (botão de baixa em massa + modal de baixa individual com upload + ícone de comprovante)
- Inserts via tool de banco (upload do extrato + baixa das 155 contas)

## Resultado esperado

- Tela "Contas a Receber" → aba "A Receber" fica vazia (R$ 0,00).
- Aba "Pago" mostra as 155 contas com data de hoje, todas com 📎 apontando para o mesmo extrato.
- Próximas baixas (individuais ou em massa) podem anexar qualquer arquivo como prova.

