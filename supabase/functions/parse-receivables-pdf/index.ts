// @ts-nocheck
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai lançamentos de contas a receber de extratos/relatórios bancários ou comerciais brasileiros (PDFs).

REGRAS CRÍTICAS:
1. Identifique CADA LANÇAMENTO/PARCELA pendente ou em aberto. NÃO PULE NENHUMA LINHA.
2. Para cada um extraia:
   - customer_name: nome do cliente/sacado/pagador (texto). Se vier no formato "NOME - CPF/CNPJ", separe.
   - tax_id: CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos. Omita se não houver.
   - description: histórico/descrição/número do título. Curto (até 80 chars).
   - amount: valor em reais (use ponto decimal). Sempre positivo.
   - due_date: data de vencimento no formato ISO YYYY-MM-DD.
3. Ignore SOMENTE totalizadores, cabeçalhos, saldos, taxas e linhas sem cliente+valor+vencimento.
4. NUNCA invente dados. Se faltar vencimento OU valor, omita a linha.
5. PROCESSE O PDF INTEIRO - todas as páginas, todas