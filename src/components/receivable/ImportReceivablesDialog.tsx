import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { digitsOnly, formatTaxId } from "@/lib/taxId";
import { findKey, parseAmount, parseDate, readFirstSheet } from "@/lib/spreadsheet";
import type { Customer, Receivable } from "./types";

type ImportRow = { customer_name: string; tax_id: string; description: string; amount: number; due_date: string };
type PreviewRow = ImportRow & { skip?: boolean; dupReason?: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: Receivable[];
  customers: Customer[];
  onImported: () => void;
}

/** Importa contas a receber de planilha ou PDF (lido pela IA), cadastrando clientes novos. */
export default function ImportReceivablesDialog({ open, onOpenChange, list, customers, onImported }: Props) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<PreviewRow[]>([]);
  const [importSaving, setImportSaving] = useState(false);
  const [importParsing, setImportParsing] = useState(false);

  // Cada abertura começa do zero (antes o botão da página zerava o estado).
  useEffect(() => {
    if (!open) return;
    setImportFile(null);
    setImportPreview([]);
  }, [open]);

  /** Marca duplicatas: dentro do próprio arquivo e contra contas já existentes no banco */
  const enrichWithDuplicates = (rows: ImportRow[]): PreviewRow[] => {
    // Índice de clientes existentes por tax_id e por nome → id
    const taxToId = new Map<string, string>();
    const nameToId = new Map<string, string>();
    customers.forEach((c) => {
      const t = digitsOnly(c.tax_id ?? "");
      if (t) taxToId.set(t, c.id);
      if (c.name) nameToId.set(c.name.trim().toLowerCase(), c.id);
    });

    // Índice de receivables existentes por chave (customer_id|valor|vencimento)
    const existingKeys = new Set<string>();
    list.forEach((r) => {
      if (r.customer_id) existingKeys.add(`${r.customer_id}|${Number(r.amount).toFixed(2)}|${r.due_date}`);
    });

    // Resolve customer_id provável de uma linha do preview
    const resolveCustomerId = (r: { customer_name: string; tax_id: string }): string | null => {
      const tax = digitsOnly(r.tax_id);
      if (tax && taxToId.has(tax)) return taxToId.get(tax)!;
      const nameKey = (r.customer_name || "").trim().toLowerCase();
      if (nameKey && nameToId.has(nameKey)) return nameToId.get(nameKey)!;
      return null;
    };

    const seenInFile = new Set<string>();
    return rows.map((r) => {
      const cid = resolveCustomerId(r);
      const amtKey = Number(r.amount).toFixed(2);
      // Chave para detectar duplicata interna ao arquivo (cliente + valor + vencimento)
      const matchKey = cid
        ? `id:${cid}|${amtKey}|${r.due_date}`
        : `name:${(r.customer_name || "").trim().toLowerCase()}|${digitsOnly(r.tax_id)}|${amtKey}|${r.due_date}`;

      let dupReason: string | undefined;
      if (cid && existingKeys.has(`${cid}|${amtKey}|${r.due_date}`)) {
        dupReason = "já existe no sistema";
      } else if (seenInFile.has(matchKey)) {
        dupReason = "duplicado no arquivo";
      }
      seenInFile.add(matchKey);
      return { ...r, skip: !!dupReason, dupReason };
    });
  };

  const parseImportFile = async (file: File) => {
    setImportParsing(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        // PDF: enviar pra edge function que usa IA pra extrair
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
        }
        const b64 = btoa(binary);
        toast.info("Lendo PDF com IA, aguarde...");
        const { data, error } = await supabase.functions.invoke("parse-receivables-pdf", {
          body: { file_base64: b64, filename: file.name },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const items = (data?.items ?? []).filter((r: any) => r.amount > 0 && r.due_date) as any[];
        const mapped = items.map((r: any) => ({
          customer_name: r.customer_name ?? "",
          tax_id: digitsOnly(r.tax_id ?? ""),
          description: r.description ?? "",
          amount: Number(r.amount),
          due_date: String(r.due_date).slice(0, 10),
        }));
        const enriched = enrichWithDuplicates(mapped);
        setImportPreview(enriched);
        const meta = data?.meta;
        const sum = items.reduce((a: number, b: any) => a + (Number(b.amount) || 0), 0);
        const dupCount = enriched.filter((r) => r.skip).length;
        const dupMsg = dupCount > 0 ? ` • ${dupCount} duplicata(s) desmarcada(s)` : "";
        if (items.length === 0) {
          toast.error("Nenhum lançamento encontrado no PDF");
        } else if (meta?.expected_count && Math.abs(meta.expected_count - items.length) > 2) {
          toast.warning(
            `Atenção: extraídas ${items.length} de ~${meta.expected_count} linhas (R$ ${sum.toFixed(2)} de ~R$ ${(meta.expected_sum ?? 0).toFixed(2)})${dupMsg}.`,
            { duration: 10000 }
          );
        } else if (meta?.expected_sum && Math.abs(meta.expected_sum - sum) > 1) {
          toast.warning(
            `Extraídas ${items.length} linhas (R$ ${sum.toFixed(2)}) — esperado R$ ${meta.expected_sum.toFixed(2)}${dupMsg}.`,
            { duration: 10000 }
          );
        } else {
          toast.success(`${items.length} linha(s) • Total R$ ${sum.toFixed(2)}${dupMsg}`);
        }
        return;
      }

      // Planilha (xlsx/xls/csv)
      const json = await readFirstSheet(file);

      const out = json.map((row) => {
        const kCust = findKey(row, ["cliente", "customer", "nome", "sacado", "pagador"]);
        const kTax = findKey(row, ["cpf", "cnpj", "cpf/cnpj", "documento", "tax_id"]);
        const kDesc = findKey(row, ["descricao", "description", "historico", "memo", "obs"]);
        const kAmt = findKey(row, ["valor", "amount", "montante"]);
        const kDue = findKey(row, ["vencimento", "due_date", "data", "vencto"]);
        return {
          customer_name: kCust ? String(row[kCust]).trim() : "",
          tax_id: kTax ? digitsOnly(String(row[kTax])) : "",
          description: kDesc ? String(row[kDesc]).trim() : "",
          amount: kAmt ? parseAmount(row[kAmt]) : 0,
          due_date: kDue ? parseDate(row[kDue]) : "",
        };
      }).filter((r) => r.amount > 0 && r.due_date);

      const enriched = enrichWithDuplicates(out);
      setImportPreview(enriched);
      const dupCount = enriched.filter((r) => r.skip).length;
      const dupMsg = dupCount > 0 ? ` • ${dupCount} duplicata(s) desmarcada(s)` : "";
      if (out.length === 0) toast.error("Nenhuma linha válida encontrada (precisa de Valor + Vencimento)");
      else toast.success(`${out.length} linha(s) prontas para importar${dupMsg}`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao ler o arquivo");
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (importPreview.length === 0) { toast.error("Nada para importar"); return; }
    setImportSaving(true);
    try {
      // Índices: por CPF/CNPJ e por nome (lowercase)
      const taxToId = new Map<string, string>();
      const nameToId = new Map<string, string>();
      const taxToCustomer = new Map<string, Customer>();
      customers.forEach((c) => {
        const t = digitsOnly(c.tax_id ?? "");
        if (t) { taxToId.set(t, c.id); taxToCustomer.set(t, c); }
        if (c.name) nameToId.set(c.name.toLowerCase(), c.id);
      });

      // 1) Para cada linha, decide o customer_id
      // - se tem tax_id e existe → usa
      // - se tem tax_id e NÃO existe, mas existe cliente com mesmo nome sem tax_id → atualiza esse cliente com o tax_id
      // - se tem tax_id e nada bate → cria novo cliente (nome + tax_id)
      // - se NÃO tem tax_id → vincula por nome; se não existir, cria por nome
      const toUpdateTax: { id: string; tax_id: string }[] = [];
      const planned: (string | null)[] = importPreview.map(() => null);

      // Primeira passada: vincular ou marcar para update/create
      const pendingNewByTax = new Map<string, number[]>(); // tax_id → índices das linhas
      const pendingNewByName = new Map<string, number[]>(); // nome.lower → índices

      importPreview.forEach((r, idx) => {
        const tax = digitsOnly(r.tax_id);
        const nameKey = (r.customer_name || "").trim().toLowerCase();

        if (tax) {
          if (taxToId.has(tax)) {
            planned[idx] = taxToId.get(tax)!;
          } else if (nameKey && nameToId.has(nameKey)) {
            const existingId = nameToId.get(nameKey)!;
            const existing = customers.find((c) => c.id === existingId);
            // Atualiza tax_id desse cliente (se ainda não tinha)
            if (existing && !digitsOnly(existing.tax_id ?? "")) {
              toUpdateTax.push({ id: existingId, tax_id: tax });
              taxToId.set(tax, existingId);
            }
            planned[idx] = existingId;
          } else {
            // Novo por tax_id
            const arr = pendingNewByTax.get(tax) ?? [];
            arr.push(idx);
            pendingNewByTax.set(tax, arr);
          }
        } else if (nameKey) {
          if (nameToId.has(nameKey)) {
            planned[idx] = nameToId.get(nameKey)!;
          } else {
            const arr = pendingNewByName.get(nameKey) ?? [];
            arr.push(idx);
            pendingNewByName.set(nameKey, arr);
          }
        }
      });

      // Atualiza tax_id de clientes existentes encontrados por nome
      if (toUpdateTax.length > 0) {
        for (const u of toUpdateTax) {
          const { error } = await supabase.from("customers").update({ tax_id: u.tax_id }).eq("id", u.id);
          if (error) throw error;
        }
      }

      // Cria os novos clientes (com tax_id e por nome)
      const newPayload: { name: string; tax_id: string | null }[] = [];
      const newKeys: { kind: "tax" | "name"; key: string }[] = [];

      for (const [tax, idxs] of pendingNewByTax.entries()) {
        const sample = importPreview[idxs[0]];
        newPayload.push({ name: (sample.customer_name || "Cliente sem nome").trim(), tax_id: tax });
        newKeys.push({ kind: "tax", key: tax });
      }
      for (const [nameKey, idxs] of pendingNewByName.entries()) {
        const sample = importPreview[idxs[0]];
        newPayload.push({ name: (sample.customer_name || "Cliente sem nome").trim(), tax_id: null });
        newKeys.push({ kind: "name", key: nameKey });
      }

      if (newPayload.length > 0) {
        const { data: created, error: cErr } = await supabase
          .from("customers")
          .insert(newPayload)
          .select("id, name, tax_id");
        if (cErr) throw cErr;
        (created ?? []).forEach((c, i) => {
          const meta = newKeys[i];
          if (meta.kind === "tax") {
            const idxs = pendingNewByTax.get(meta.key) ?? [];
            idxs.forEach((idx) => { planned[idx] = c.id; });
          } else {
            const idxs = pendingNewByName.get(meta.key) ?? [];
            idxs.forEach((idx) => { planned[idx] = c.id; });
          }
        });
      }

      // Filtra duplicatas (skip=true)
      const rows = importPreview
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => !r.skip)
        .map(({ r, idx }) => ({
          customer_id: planned[idx],
          description: r.description || null,
          amount: r.amount,
          due_date: r.due_date,
        }));

      const skipped = importPreview.length - rows.length;
      if (rows.length === 0) {
        toast.error("Todas as linhas foram identificadas como duplicadas");
        setImportSaving(false);
        return;
      }

      const { error } = await supabase.from("accounts_receivable").insert(rows);
      if (error) throw error;

      const stats = {
        total: rows.length,
        updated: toUpdateTax.length,
        created: newPayload.length,
        skipped,
      };
      toast.success(
        `${stats.total} conta(s) importadas • ${stats.created} cliente(s) novo(s) • ${stats.updated} atualizado(s)${stats.skipped > 0 ? ` • ${stats.skipped} duplicata(s) ignorada(s)` : ""}`
      );
      onOpenChange(false);
      onImported();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImportSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-2xl">
        <DialogHeader><DialogTitle>Importar contas a receber</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Anexe um arquivo <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong> ou <strong>.pdf</strong>.
            Em planilhas, use colunas: <strong>Cliente</strong>, <strong>Descrição</strong>, <strong>Valor</strong> e <strong>Vencimento</strong>.
            PDFs (extratos bancários) são lidos automaticamente pela IA.
            Clientes novos serão cadastrados automaticamente.
          </div>
          <div>
            <Label>Arquivo</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              disabled={importParsing}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setImportFile(f);
                setImportPreview([]);
                if (f) parseImportFile(f);
              }}
              className="glass-input"
            />
            {importFile && <div className="text-xs text-muted-foreground mt-1">{importFile.name}</div>}
            {importParsing && <div className="text-xs text-primary mt-1">Lendo arquivo...</div>}
          </div>
          {importPreview.length > 0 && (() => {
            const dupCount = importPreview.filter((r) => r.skip).length;
            const includedCount = importPreview.length - dupCount;
            const includedSum = importPreview.filter((r) => !r.skip).reduce((a, b) => a + (b.amount || 0), 0);
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      <strong className="text-foreground">{includedCount}</strong> a importar • <strong className="text-foreground">R$ {includedSum.toFixed(2)}</strong>
                    </span>
                    {dupCount > 0 && (
                      <span className="text-amber-600">
                        {dupCount} duplicata(s) detectada(s)
                      </span>
                    )}
                  </div>
                  {dupCount > 0 && (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => setImportPreview((prev) => prev.map((r) => ({ ...r, skip: false })))}
                    >
                      Importar mesmo assim
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th scope="col" className="text-center p-2 w-8">✓</th>
                        <th scope="col" className="text-left p-2">Cliente</th>
                        <th scope="col" className="text-left p-2">CPF/CNPJ</th>
                        <th scope="col" className="text-left p-2">Status</th>
                        <th scope="col" className="text-left p-2">Descrição</th>
                        <th scope="col" className="text-left p-2">Vencimento</th>
                        <th scope="col" className="text-right p-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 50).map((r, i) => {
                        const tax = digitsOnly(r.tax_id);
                        const byTax = tax ? customers.find((c) => digitsOnly(c.tax_id ?? "") === tax) : null;
                        const byName = !byTax && r.customer_name
                          ? customers.find((c) => c.name.toLowerCase() === r.customer_name.toLowerCase())
                          : null;
                        const matched = byTax || byName;
                        return (
                          <tr key={i} className={`border-t border-border ${r.skip ? "opacity-50" : ""}`}>
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={!r.skip}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setImportPreview((prev) => prev.map((row, idx) => idx === i ? { ...row, skip: !checked } : row));
                                }}
                              />
                            </td>
                            <td className="p-2">{r.customer_name || "—"}</td>
                            <td className="p-2 font-mono text-[11px]">{tax ? formatTaxId(tax) : "—"}</td>
                            <td className="p-2">
                              {r.dupReason ? (
                                <span className="text-amber-600 text-[11px]">⚠ {r.dupReason}</span>
                              ) : matched ? (
                                <span className="text-success text-[11px]">✓ vinculado{byTax ? " (CPF/CNPJ)" : " (nome)"}</span>
                              ) : (
                                <span className="text-amber-600 text-[11px]">+ novo cadastro</span>
                              )}
                            </td>
                            <td className="p-2">{r.description || "—"}</td>
                            <td className="p-2">{r.due_date}</td>
                            <td className="p-2 text-right">R$ {r.amount.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {importPreview.length > 50 && (
                    <div className="p-2 text-center text-xs text-muted-foreground">
                      ... e mais {importPreview.length - 50} linha(s)
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importSaving}>Cancelar</Button>
          <Button
            onClick={confirmImport}
            disabled={importSaving || importPreview.filter((r) => !r.skip).length === 0}
            className="bg-gradient-primary text-primary-foreground"
          >
            {importSaving ? "Importando..." : `Importar ${importPreview.filter((r) => !r.skip).length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
