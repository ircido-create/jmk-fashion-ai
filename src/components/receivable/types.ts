export interface Customer { id: string; name: string; nickname: string | null; tax_id: string | null; phone: string | null; }

export interface Receivable {
  id: string; customer_id: string | null; description: string | null;
  amount: number; due_date: string; status: string; paid_at: string | null;
  customers?: { name: string; nickname: string | null; tax_id: string | null; phone: string | null } | null;
  proofs?: { proof_id: string; original_filename: string | null; storage_path: string; payment_date: string | null }[];
}
