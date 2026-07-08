import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, User, Loader2, KeyRound, UserPlus } from "lucide-react";
import { Label } from "@/components/ui/label";

interface UserRow {
  id: string; full_name: string | null; email: string | null; active: boolean;
  roles: string[];
}

export default function Users() {
  const { user: me } = useAuth();
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pwUser, setPwUser] = useState<UserRow | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "vendedor">("vendedor");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from("profiles").select("*").order("created_at");
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const rows: UserRow[] = (profiles ?? []).map((p: any) => ({
      ...p,
      roles: (roles ?? []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role),
    }));
    setList(rows); setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (u: UserRow) => {
    const { error } = await supabase.from("profiles").update({ active: !u.active }).eq("id", u.id);
    if (error) toast.error(error.message); else { toast.success("Atualizado"); load(); }
  };

  const setRole = async (u: UserRow, role: "admin" | "vendedor") => {
    if (u.roles.includes(role)) return;
    // Remove old roles, add new
    await supabase.from("user_roles").delete().eq("user_id", u.id);
    const { error } = await supabase.from("user_roles").insert({ user_id: u.id, role });
    if (error) toast.error(error.message); else { toast.success(`Papel definido: ${role}`); load(); }
  };

  const savePassword = async () => {
    if (!pwUser || pwValue.length < 6) {
      toast.error("Senha precisa ter ao menos 6 caracteres");
      return;
    }
    setPwSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-set-password", {
      body: { user_id: pwUser.id, password: pwValue },
    });
    setPwSaving(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Falha ao redefinir");
      return;
    }
    toast.success(`Senha de ${pwUser.email} redefinida`);
    setPwUser(null); setPwValue("");
  };

  const createUser = async () => {
    if (!newEmail || newPassword.length < 6) {
      toast.error("E-mail e senha (mín. 6) obrigatórios");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: { email: newEmail.trim(), password: newPassword, full_name: newFullName.trim() || newEmail, role: newRole },
    });
    setCreating(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Falha ao criar");
      return;
    }
    toast.success(`Usuário ${newEmail} criado`);
    setCreateOpen(false);
    setNewEmail(""); setNewPassword(""); setNewFullName(""); setNewRole("vendedor");
    load();
  };

  return (
    <div>
      <PageHeader title="Usuários" description="Gestão de acesso ao sistema" actions={
        <Button onClick={() => setCreateOpen(true)} className="bg-gradient-primary text-primary-foreground">
          <UserPlus className="h-4 w-4 mr-2" /> Novo usuário
        </Button>
      } />



      <GlassCard>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-2">
            {list.map((u) => {
              const isMe = u.id === me?.id;
              const isAdmin = u.roles.includes("admin");
              return (
                <div key={u.id} className="p-4 rounded-2xl bg-white/40 backdrop-blur">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="h-9 w-9 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
                          {(u.full_name || u.email || "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name || "—"} {isMe && <span className="text-[10px] text-primary">(você)</span>}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-3">
                        <Button size="sm" variant={isAdmin ? "default" : "outline"}
                          onClick={() => setRole(u, "admin")} disabled={isMe}
                          className={isAdmin ? "bg-gradient-primary text-primary-foreground" : ""}>
                          <Shield className="h-3 w-3 mr-1" /> Admin
                        </Button>
                        <Button size="sm" variant={!isAdmin ? "default" : "outline"}
                          onClick={() => setRole(u, "vendedor")} disabled={isMe}
                          className={!isAdmin ? "bg-gradient-primary text-primary-foreground" : ""}>
                          <User className="h-3 w-3 mr-1" /> Vendedor
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Ativo</span>
                        <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} disabled={isMe} />
                      </div>
                      <Button size="sm" variant="outline"
                        onClick={() => { setPwUser(u); setPwValue(""); }}>
                        <KeyRound className="h-3 w-3 mr-1" /> Redefinir senha
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          Para criar novos usuários, peça que se cadastrem na tela de login. Você pode então definir o papel e ativar/desativar o acesso aqui.
        </p>
      </GlassCard>

      <Dialog open={!!pwUser} onOpenChange={(o) => { if (!o) { setPwUser(null); setPwValue(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Usuário: <b>{pwUser?.email}</b></p>
            <Input type="text" placeholder="Nova senha (mín. 6)" value={pwValue}
              onChange={(e) => setPwValue(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwUser(null)}>Cancelar</Button>
            <Button onClick={savePassword} disabled={pwSaving}>
              {pwSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
