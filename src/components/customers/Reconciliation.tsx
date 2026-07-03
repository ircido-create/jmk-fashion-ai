import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Merge, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatTaxId } from "@/lib/taxId";

interface Customer {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  tax_id: string | null;
}

interface Pair {
  a: Customer;
  b: Customer;
  reason: string;
  keepId: string;
}

interface Counts {
  [customerId: string]: { sales: number; receivable: number };
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function detectPairs(customers: Customer[], counts: Counts, ignored: Set<string>): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();

  const pairKey = (x: string, y: string) => [x, y].sort().join("|");

  const chooseKeep = (a: Customer, b: Customer): string => {
    const score = (c: Customer) => {
      const cnt = counts[c.id] ?? { sales: 0, receivable: 0 };
      return (
        cnt.sales * 10 +
        cnt.receivable * 5 +
        (c.tax_id ? 3 : 0) +
        (c.nickname ? 2 : 0) +
        (c.phone ? 1 : 0) +
        (c.email ? 1 : 0) +
        (c.address ? 1 : 0) +
        c.name.length * 0.01
      );
    };
    return score(a) >= score(b) ? a.id : b.id;
  };

  // Rule 1: same tax_id
  const byTax = new Map<string, Customer[]>();
  for (const c of customers) {
    const d = digits(c.tax_id);
    if (!d) continue;
    if (!byTax.has(d)) byTax.set(d, []);
    byTax.get(d)!.push(c);
  }
  for (const arr of byTax.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const k = pairKey(arr[i].id, arr[j].id);
        if (ignored.has(k) || seen.has(k)) continue;
        seen.add(k);
        pairs.push({
          a: arr[i],
          b: arr[j],
          reason: "Mesmo CPF/CNPJ",
          keepId: chooseKeep(arr[i], arr[j]),
        });
      }
    }
  }

  // Rule 2: name prefix / equal (>=10 chars normalized)
  const withKey = customers.map((c) => ({ c, k: norm(c.name) }));
  for (let i = 0; i < withKey.length; i++) {
    for (let j = i + 1; j < withKey.length; j++) {
      const a = withKey[i];
      const b = withKey[j];
      if (!a.k || !b.k) continue;
      const shorter = a.k.length <= b.k.length ? a : b;
      const longer = shorter === a ? b : a;
      if (shorter.k.length < 10) continue;
      if (longer.k === shorter.k || longer.k.startsWith(shorter.k + " ") || longer.k.startsWith(shorter.k)) {
        const k = pairKey(a.c.id, b.c.id);
        if (ignored.has(k) || seen.has(k)) continue;
        seen.add(k);
        const reason = longer.k === shorter.k ? "Nome idêntico" : "Nome truncado (prefixo)";
        pairs.push({
          a: a.c,
          b: b.c,
          reason,
          keepId: chooseKeep(a.c, b.c),
        });
      }
    }
  }

  return pairs;
}

export default function CustomerReconciliation() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
  const [ignoredRows, setIgnoredRows] = useState<{ id: string; customer_a_id: string; customer_b_id: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [overrideKeep, setOverrideKeep] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const all = await fetchAll<Customer>((sb) =>
        sb.from("customers").select("id,name,nickname,phone,email,address,notes,tax_id").order("name")
      );
      const [salesRes, recRes, ignRes] = await Promise.all([
        supabase.from("sales").select("customer_id"),
        supabase.from("accounts_receivable").select("customer_id"),
        supabase.from("customer_merge_ignored").select("id,customer_a_id,customer_b_id"),
      ]);
      const c: Counts = {};
      for (const r of salesRes.data ?? []) {
        if (!r.customer_id) continue;
        c[r.customer_id] ??= { sales: 0, receivable: 0 };
        c[r.customer_id].sales++;
      }
      for (const r of recRes.data ?? []) {
        if (!r.customer_id) continue;
        c[r.customer_id] ??= { sales: 0, receivable: 0 };
        c[r.customer_id].receivable++;
      }
      const ign = ignRes.data ?? [];
      setIgnoredRows(ign);
      setIgnoredKeys(new Set(ign.map((r) => [r.customer_a_id, r.customer_b_id].sort().join("|"))));
      setCustomers(all);
      setCounts(c);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pairs = useMemo(() => detectPairs(customers, counts, ignoredKeys), [customers, counts, ignoredKeys]);

  const merge = async (pair: Pair) => {
    const key = [pair.a.id, pair.b.id].sort().join("|");
    const keepId = overrideKeep[key] ?? pair.keepId;
    const dropId = keepId === pair.a.id ? pair.b.id : pair.a.id;
    const dropName = keepId === pair.a.id ? pair.b.name : pair.a.name;
    const keepName = keepId === pair.a.id ? pair.a.name : pair.b.name;
    if (!confirm(`Mesclar "${dropName}" em "${keepName}"?\n\nVendas e contas a receber serão movidas e o cadastro duplicado será excluído.`)) return;
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("merge-customers", {
        body: { keep_id: keepId, drop_id: dropId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const moves = (data as any)?.moves ?? {};
      toast.success(`Mesclado. Vendas: ${moves.sales ?? 0}, receber: ${moves.accounts_receivable ?? 0}`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao mesclar");
    } finally {
      setBusy(null);
    }
  };

  const ignore = async (pair: Pair) => {
    const [a, b] = [pair.a.id, pair.b.id].sort();
    setBusy([pair.a.id, pair.b.id].sort().join("|"));
    try {
      const { error } = await supabase.from("customer_merge_ignored").insert({ customer_a_id: a, customer_b_id: b });
      if (error) throw error;
      toast.success("Par ignorado");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const unignore = async (row: { id: string }) => {
    const { error } = await supabase.from("customer_merge_ignored").delete().eq("id", row.id);
    if (error) toast.error(error.message);
    else { toast.success("Restaurado"); load(); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Analisando cadastros...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {pairs.length === 0
            ? "Nenhuma duplicidade detectada."
            : `${pairs.length} par(es) suspeitos de duplicidade.`}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="rounded-xl">
          <RefreshCw className="h-4 w-4 mr-1" /> Reanalisar
        </Button>
      </div>

      {pairs.map((pair) => {
        const key = [pair.a.id, pair.b.id].sort().join("|");
        const currentKeep = overrideKeep[key] ?? pair.keepId;
        const renderSide = (c: Customer, isKeep: boolean) => {
          const cnt = counts[c.id] ?? { sales: 0, receivable: 0 };
          return (
            <div
              className={`flex-1 p-3 rounded-xl border transition-all cursor-pointer ${
                isKeep ? "border-primary bg-primary/5" : "border-border/40 bg-white/40 dark:bg-white/5"
              }`}
              onClick={() => setOverrideKeep((o) => ({ ...o, [key]: c.id }))}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {isKeep ? "Manter (canônico)" : "Será mesclado"}
                </span>
              </div>
              <div className="font-medium truncate">{c.name}</div>
              <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <div>Apelido: {c.nickname || "—"}</div>
                <div>CPF/CNPJ: {c.tax_id ? formatTaxId(c.tax_id) : "—"}</div>
                <div>Telefone: {c.phone || "—"}</div>
                <div>
                  Vendas: {cnt.sales} · Receber: {cnt.receivable}
                </div>
              </div>
            </div>
          );
        };

        return (
          <div key={key} className="p-4 rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur border border-border/30">
            <div className="text-xs text-muted-foreground mb-2">
              Motivo: <span className="font-medium text-foreground">{pair.reason}</span> · clique no cadastro que deve ser mantido
            </div>
            <div className="flex flex-col md:flex-row items-stretch gap-2">
              {renderSide(pair.a, currentKeep === pair.a.id)}
              <div className="hidden md:flex items-center justify-center px-2">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>
              {renderSide(pair.b, currentKeep === pair.b.id)}
            </div>
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="ghost" size="sm" onClick={() => ignore(pair)} disabled={busy === key} className="rounded-xl">
                <X className="h-4 w-4 mr-1" /> Ignorar
              </Button>
              <Button size="sm" onClick={() => merge(pair)} disabled={busy === key} className="bg-gradient-primary text-primary-foreground rounded-xl">
                {busy === key ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Merge className="h-4 w-4 mr-1" />} Mesclar
              </Button>
            </div>
          </div>
        );
      })}

      {ignoredRows.length > 0 && (
        <details className="mt-6">
          <summary className="text-sm text-muted-foreground cursor-pointer">
            {ignoredRows.length} par(es) marcados como "não são duplicatas"
          </summary>
          <div className="mt-2 space-y-1">
            {ignoredRows.map((r) => {
              const a = customers.find((c) => c.id === r.customer_a_id);
              const b = customers.find((c) => c.id === r.customer_b_id);
              return (
                <div key={r.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/30 dark:bg-white/5">
                  <span className="truncate">
                    {a?.name ?? "?"} ↔ {b?.name ?? "?"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => unignore(r)} className="h-7">
                    Restaurar
                  </Button>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
