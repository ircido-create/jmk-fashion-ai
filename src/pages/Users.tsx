import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Shield, User, Loader2, KeyRound } from "lucide-react";

interface UserRow {
  id: string; full_name: string | null; email: string | null; active: boolean;
  roles: string[];
}

export default function Users() {
  const { user: me } = useAuth();
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <PageHeader title="Usuários" description="Gestão de acesso ao sistema" />

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
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">Ativo</span>
                      <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} disabled={isMe} />
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
    </div>
  );
}
