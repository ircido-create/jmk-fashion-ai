import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

export interface SaleItemsDialogSale {
  id: string;
  total: number;
  payment_method: string | null;
  customers: { name: string } | null;
  sale_items: { id: string; product_name: string; variant_label: string | null; quantity: number; unit_price: number }[];
}

type Pendente = { itemId: string; nome: string; de: number; para: number; diferenca: number };

/**
 * Alterar a quantidade de um item da venda ou excluir o item. A regra fica no
 * banco (alterar_item_venda): estoque, total e parcelas em aberto mudam juntos;
 * a diferença de valor é dividida igualmente entre as parcelas em aberto.
 */
export default function SaleItemsDialog({
  sale,
  onClose,
  onChanged,
}: {
  sale: SaleItemsDialogSale | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [parcelas, setParcelas] = useState<{ n: number; aberto: number } | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setPendente(null);
    setParcelas(null);
    if (!sale) return;
    setQtds(Object.fromEntries(sale.sale_items.map((it) => [it.id, String(it.quantity)])));
    supabase
      .from("accounts_receivable")
      .select("amount")
      .eq("sale_id", sale.id)
      .in("status", ["pendente", "vencido"])
      .then(({ data, error }) => {
        if (error) { toast.error(error.message); return; }
        const rows = data ?? [];
        setParcelas({ n: rows.length, aberto: rows.reduce((s, r) => s + Number(r.amount), 0) });
      });
  }, [sale]);

  if (!sale) return null;

  const prepararAlteracao = (itemId: string, para: number) => {
    const it = sale.sale_items.find((x) => x.id === itemId)!;
    if (!Number.isInteger(para) || para < 0) { toast.error("Quantidade inválida"); return; }
    if (para === it.quantity) { toast.info("A quantidade não mudou"); return; }
    setPendente({
      itemId,
      nome: `${it.product_name}${it.variant_label ? ` (${it.variant_label})` : ""}`,
      de: it.quantity,
      para,
      diferenca: Math.round(Number(it.unit_price) * (para - it.quantity) * 100) / 100,
    });
  };

  const confirmar = async () => {
    if (!pendente) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc("alterar_item_venda", {
      p_item_id: pendente.itemId,
      p_nova_quantidade: pendente.para,
    });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    const r = (data ?? {}) as Record<string, unknown>;
    const partes = [`Total: ${fmtBRL(Number(r.total_anterior))} → ${fmtBRL(Number(r.total_novo))}`];
    const mexidas = Number(r.parcelas_ajustadas ?? 0) + Number(r.parcelas_quitadas ?? 0) + Number(r.parcelas_removidas ?? 0);
    if (mexidas > 0) partes.push(`${mexidas} parcela(s) ajustada(s)`);
    if (r.parcela_nova) partes.push("parcela nova criada para daqui a 30 dias");
    toast.success(pendente.para === 0 ? "Item excluído" : "Quantidade alterada", { description: partes.join(" · ") });
    setPendente(null);
    onChanged();
    onClose();
  };

  const totalNovo = pendente ? Number(sale.total) + pendente.diferenca : null;
  const fiado = ["fiado", "misto"].includes(sale.payment_method ?? "");

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && !salvando && onClose()}>
      <DialogContent className="glass-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Itens da venda</DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          {sale.customers?.name ?? "Sem cliente"} · total {fmtBRL(Number(sale.total))}
          {parcelas && parcelas.n > 0 && ` · ${parcelas.n} parcela(s) em aberto (${fmtBRL(parcelas.aberto)})`}
        </div>

        {!pendente ? (
          <div className="space-y-2">
            {sale.sale_items.map((it) => {
              const valor = qtds[it.id] ?? String(it.quantity);
              const mudou = Number(valor) !== it.quantity;
              return (
                <div key={it.id} className="flex items-center gap-2 p-2 rounded-xl bg-white/40 dark:bg-white/5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {it.product_name}{it.variant_label ? ` (${it.variant_label})` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtBRL(Number(it.unit_price))} cada</div>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={valor}
                    onChange={(e) => setQtds((q) => ({ ...q, [it.id]: e.target.value }))}
                    className="glass-input w-20"
                    aria-label={`Quantidade de ${it.product_name}`}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={!mudou || Number(valor) < 1}
                    onClick={() => prepararAlteracao(it.id, Number(valor))}
                    title="Salvar quantidade"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    disabled={sale.sale_items.length === 1}
                    onClick={() => prepararAlteracao(it.id, 0)}
                    title={sale.sale_items.length === 1 ? "Único item — exclua a venda inteira" : "Excluir item"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {sale.sale_items.length === 1 && (
              <p className="text-xs text-muted-foreground">Este é o único item: para tirá-lo, use "Excluir venda".</p>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {pendente.para === 0
                ? `Excluir ${pendente.de}× ${pendente.nome}?`
                : `Alterar ${pendente.nome} de ${pendente.de} para ${pendente.para}?`}
            </p>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>
                Total da venda: {fmtBRL(Number(sale.total))} → <b>{fmtBRL(totalNovo ?? 0)}</b>{" "}
                ({pendente.diferenca < 0 ? "-" : "+"}{fmtBRL(Math.abs(pendente.diferenca))})
              </li>
              <li>
                {pendente.para < pendente.de
                  ? `${pendente.de - pendente.para} peça(s) voltam ao estoque`
                  : `${pendente.para - pendente.de} peça(s) saem do estoque`}
              </li>
              {parcelas && parcelas.n > 0 ? (
                <li>
                  A diferença é dividida igualmente entre as {parcelas.n} parcela(s) em aberto
                  {pendente.diferenca < 0 && -pendente.diferenca > parcelas.aberto && (
                    <span className="text-destructive"> — maior que o saldo em aberto ({fmtBRL(parcelas.aberto)}): o sistema vai recusar</span>
                  )}
                </li>
              ) : fiado && pendente.diferenca > 0 ? (
                <li>Sem parcela em aberto: o sistema cria uma parcela nova para daqui a 30 dias</li>
              ) : (
                <li>Sem parcela em aberto: muda só o total (devolução ou cobrança de dinheiro é por fora)</li>
              )}
              <li>Fica anotado nas observações da venda</li>
            </ul>
          </div>
        )}

        <DialogFooter>
          {pendente ? (
            <>
              <Button variant="outline" onClick={() => setPendente(null)} disabled={salvando}>Voltar</Button>
              <Button
                variant={pendente.para === 0 ? "destructive" : "default"}
                onClick={confirmar}
                disabled={salvando}
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : pendente.para === 0 ? "Excluir item" : "Confirmar"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
