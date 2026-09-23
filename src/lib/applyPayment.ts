import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationAction } from "@/lib/reconcile";

/** Dados do comprovante a criar junto com a baixa (quando não há um comprovante existente). */
export interface NewProof {
  storage_path?: string;
  bucket?: string;
  original_filename?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  description?: string | null;
  customer_id?: string | null;
}

export interface AppliedPayment {
  proof_id: string;
  settled: number;
  reduced: number;
  paid_total: number;
}

/**
 * Aplica a baixa numa única transação no banco (`apply_receivable_payment`):
 * quita/reduz as parcelas, cria o comprovante (ou usa `proofId`) e grava os
 * vínculos. Se qualquer parte falhar, nada é gravado. A função também recusa a
 * baixa se alguma parcela mudou desde que a tela foi carregada.
 */
export async function applyReceivablePayment(opts: {
  actions: ReconciliationAction[];
  paidAtIso: string;
  proofId?: string;
  proof?: NewProof;
}): Promise<AppliedPayment> {
  const { data, error } = await supabase.rpc("apply_receivable_payment", {
    p_actions: opts.actions.map((a) => ({
      receivable_id: a.receivable_id,
      kind: a.kind,
      amount_paid: a.amount_paid,
      expected_amount: a.original_amount,
    })),
    p_paid_at: opts.paidAtIso,
    p_proof_id: opts.proofId,
    p_proof: opts.proof ? { ...opts.proof } : undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AppliedPayment;
}
