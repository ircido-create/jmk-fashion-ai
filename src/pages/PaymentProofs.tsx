import { useEffect, useMemo, useState } from "react";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FileText, Image as ImageIcon, ExternalLink, Sparkles, Search } from "lucide-react";

interface Proof {
  id: string;
  created_at: string;
  storage_path: string;
  bucket: string | null;
  original_filename: string | null;
  mime_type: string | null;
  source: string;
  customer_id: string | null;
  ai_is_payment_proof: boolean | null;
  ai_amount: number | null;
  ai_payer_name: string | null;
  ai_bank: string | null;
  ai_transaction_id: string | null;
  ai_summary: string | null;
  customer?: { name: string | null; phone: string | null } | null;
}

const currency = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PaymentProofs() {
  const { toast } = useToast();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_proofs")
      .select("id, created_at, storage_path, bucket, original_filename, mime_type, source, customer_id, ai_is_payment_proof, ai_amount, ai_payer_name, ai_bank, ai_transaction_id, ai_summary, customers(name, phone)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar comprovantes", description: error.message, variant: "destructive" });
    } else {
      const rows: Proof[] = (data ?? []).map((r: any) => ({ ...r, customer: r.customers }));
      setProofs(rows);
      // pega URLs assinadas para todos os que estão no bucket whatsapp-media
      const paths = rows.filter((r) => (r.bucket ?? "payment-proofs") === "whatsapp-media").map((r) => r.storage_path);
      if (paths.length > 0) {
        const { data: signed } = await supabase.functions.invoke("whatsapp-media-url", { body: { paths } });
        if (signed?.urls) setUrls(signed.urls);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return proofs;
    return proofs.filter((p) =>
      [p.ai_payer_name, p.ai_bank, p.ai_transaction_id, p.ai_summary, p.customer?.name, p.customer?.phone, p.original_filename]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    );
  }, [proofs, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprovantes"
        description="Comprovantes de pagamento recebidos das clientes — analisados automaticamente pela Mônica"
        icon={FileText}
      />

      <GlassCard>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por pagador, banco, valor, cliente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard><p className="text-sm text-muted-foreground">Carregando…</p></GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="text-center py-12">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhum comprovante encontrado.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const url = urls[p.storage_path];
            const isImage = (p.mime_type ?? "").startsWith("image/");
            const isPdf = (p.mime_type ?? "").includes("pdf");
            return (
              <GlassCard key={p.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.customer?.name ?? p.ai_payer_name ?? "Cliente desconhecida"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.customer?.phone ?? p.original_filename ?? p.storage_path}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.source === "monica" && (
                      <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" />Mônica</Badge>
                    )}
                    {p.ai_is_payment_proof === false && (
                      <Badge variant="destructive">Não é comprovante</Badge>
                    )}
                    {p.ai_is_payment_proof === true && (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Comprovante</Badge>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden aspect-video flex items-center justify-center">
                  {url && isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="Comprovante" className="w-full h-full object-contain" />
                  ) : url && isPdf ? (
                    <a href={url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-sm text-primary">
                      <FileText className="h-8 w-8" /> Abrir PDF
                    </a>
                  ) : (
                    <div className="text-xs text-muted-foreground flex flex-col items-center gap-1">
                      <ImageIcon className="h-6 w-6" /> {p.mime_type ?? "arquivo"}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Valor</div>
                    <div className="font-semibold">{currency(p.ai_amount)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Banco</div>
                    <div className="font-medium truncate">{p.ai_bank ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Pagador</div>
                    <div className="font-medium truncate">{p.ai_payer_name ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">ID transação</div>
                    <div className="font-mono truncate">{p.ai_transaction_id ?? "—"}</div>
                  </div>
                </div>

                {p.ai_summary && (
                  <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{p.ai_summary}</p>
                )}

                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>{new Date(p.created_at).toLocaleString("pt-BR")}</span>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Abrir <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
