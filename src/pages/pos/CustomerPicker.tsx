import { GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, UserPlus } from "lucide-react";
import type { Customer } from "./types";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  customers: Customer[];
  selectedId: string;
  onSelect: (c: Customer) => void;
  onNewCustomer: () => void;
}

/** Passo 2 do PDV: busca (no servidor) e escolha da cliente. */
export function CustomerPicker({ search, onSearchChange, customers, selectedId, onSelect, onNewCustomer }: Props) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <Label className="block">Selecionar cliente</Label>
        <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={onNewCustomer}>
          <UserPlus className="h-4 w-4 mr-1" /> Novo cliente
        </Button>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Buscar cliente por nome ou telefone…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="glass-input"
        />
      </div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {customers.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className={`w-full text-left rounded-lg px-3 py-2 transition-all border ${
              selectedId === c.id
                ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow"
                : "border-border bg-white/40 dark:bg-white/5 hover:border-primary"
            }`}
          >
            <div className="font-medium text-sm">{c.name}{c.nickname ? <span className={`ml-1 text-xs font-normal ${selectedId === c.id ? "opacity-90" : "text-muted-foreground"}`}>({c.nickname})</span> : null}</div>
            {c.phone && (
              <div className={`text-xs ${selectedId === c.id ? "opacity-90" : "text-muted-foreground"}`}>
                {c.phone}
              </div>
            )}
          </button>
        ))}
        {customers.length === 0 && (
          <div className="text-center py-6 space-y-3">
            <div className="text-sm text-muted-foreground">Nenhum cliente encontrado</div>
            <Button type="button" size="sm" className="rounded-xl" onClick={onNewCustomer}>
              <UserPlus className="h-4 w-4 mr-1" /> Adicionar novo cliente
            </Button>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
