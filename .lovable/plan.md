

## Ajuste: "Pendente" deve incluir o que está vencido

### O problema atual

Hoje a página **Contas a Receber** trata "Pendente" e "Vencido" como categorias separadas:

- **Pendente** = `status = 'pendente'` E `due_date >= hoje` → R$ 74.879,00
- **Vencido** = `status = 'pendente'` E `due_date < hoje` → R$ 25.153,04
- **Total a receber real** = R$ 100.032,04

Isso causa confusão: tudo que ainda não foi pago é, na prática, **a receber**. Vencido é apenas um sub-estado de pendente.

### Mudança proposta

Reorganizar os filtros/abas de **Contas a Receber** (e aplicar o mesmo a **Contas a Pagar**) para refletir a realidade financeira:

**Novas abas:**

| Aba | Critério | Significado |
|---|---|---|
| **Todos** | tudo | Visão completa |
| **A Receber** (padrão) | `status = 'pendente'` (vencido + a vencer) | **R$ 100.032,04** — tudo que ainda entra |
| **↳ A vencer** | `pendente` + `due_date >= hoje` | R$ 74.879,00 |
| **↳ Vencido** | `pendente` + `due_date < hoje` | R$ 25.153,04 — destacado em vermelho |
| **Pago** | `status = 'pago'` | Histórico recebido |

"A vencer" e "Vencido" viram **sub-filtros** (chips/toggle) dentro de "A Receber", não abas irmãs do mesmo nível.

### Indicador visual no topo

Cards de resumo sempre visíveis (independente do filtro):

```text
┌─────────────────┬─────────────────┬─────────────────┐
│  A RECEBER      │  ↳ Vencido      │  Recebido (mês) │
│  R$ 100.032,04  │  R$ 25.153,04   │  R$ X.XXX,XX    │
│  425 títulos    │  117 títulos    │                 │
└─────────────────┴─────────────────┴─────────────────┘
```

Assim você bate o olho e vê o número que esperava (≈100k) sem precisar trocar filtro.

### Mesma lógica para Contas a Pagar

Espelhar:
- **A Pagar** (padrão) = pendente + vencido somados
- Sub-filtros: A vencer / Vencido
- **Pago** = histórico

### Arquivos afetados

- `src/pages/Receivable.tsx` — reestruturar abas e cards de totais
- `src/pages/Payable.tsx` — mesma reestruturação
- `src/lib/financePdf.ts` — ajustar agrupamento do resumo no PDF (somar pendente+vencido como "A receber/pagar")

### Detalhes técnicos

- Sem alterações de schema nem de dados — `status` continua `pendente` no banco; "vencido" segue sendo derivado de `due_date < now()` no frontend.
- Filtro padrão da página passa a ser **"A Receber"** (que já mostra os 100k), com toggle interno para isolar vencidos quando precisar cobrar.
- Cards de totais usam `useMemo` sobre o dataset completo (não o filtrado), pra sempre mostrar o valor real.

