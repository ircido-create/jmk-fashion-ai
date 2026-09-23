import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O que estava digitado na busca vira o nome sugerido. */
  initialName: string;
  onCreated: (c: Customer) => void;
}

/** Cadastro rápido de cliente sem sair do PDV. */
export function NewCustomerDialog({ open, onOpenChange, initialName, onCreated }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setPhone("");
  }, [open, initialName]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Informe o nome"); return; }
    setCreating(true);
    const { data, error } = await supabase
      .from("customers")
      .insert({ name: trimmed, phone: phone.trim() || null })
      .select("id, name, nickname, phone")
      .single();
    setCreating(false);
    if (error || !data) { toast.error(error?.message || "Falha ao cadastrar"); return; }
    onCreated(data as Customer);
    onOpenChange(false);
    toast.success("Cliente cadastrado");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block">Nome *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do cliente"
              className="glass-input"
            />
          </div>
          <div>
            <Label className="mb-1 block">Telefone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(00) 00000-0000"
              className="glass-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={creating} className="bg-gradient-primary text-primary-foreground">
            {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
