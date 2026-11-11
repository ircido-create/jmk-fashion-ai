import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AppRole = "admin" | "vendedor";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Carrega os papéis do usuário.
   *
   * O erro não pode ser descartado: uma falha momentânea aqui zerava `roles`, o
   * que torna `isAdmin` falso e expulsa o administrador de /usuarios e
   * /configuracoes sem nenhuma explicação. Em caso de erro, tenta de novo e
   * preserva os papéis já carregados em vez de rebaixar o usuário.
   */
  const loadRoles = async (uid: string, tentativa = 1): Promise<void> => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);

    if (error) {
      if (tentativa < 3) {
        await new Promise((r) => setTimeout(r, tentativa * 500));
        return loadRoles(uid, tentativa + 1);
      }
      console.error("[AuthContext] não foi possível carregar os papéis:", error.message);
      return; // mantém o que já havia — não rebaixa por falha de rede
    }

    setRoles(data.map((r) => r.role as AppRole));
  };

  /**
   * Confere se o acesso continua liberado.
   *
   * A chave "ativo" da tela de Usuários bloqueia o login e derruba a sessão no
   * banco, mas o token que já está no navegador vale até vencer (cerca de uma
   * hora). Esta conferência fecha essa janela: quem foi desativado sai do
   * sistema na primeira vez que o aplicativo carrega, com explicação.
   *
   * Erro de rede não expulsa ninguém — só o "false" vindo do banco expulsa.
   */
  const conferirAcesso = async (uid: string, tentativa = 1): Promise<void> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", uid)
      .maybeSingle();

    if (error) {
      if (tentativa < 3) {
        await new Promise((r) => setTimeout(r, tentativa * 500));
        return conferirAcesso(uid, tentativa + 1);
      }
      console.error("[AuthContext] não foi possível conferir o acesso:", error.message);
      return;
    }

    if (data && data.active === false) {
      toast.error("Seu acesso foi desativado. Procure a administração da loja.");
      await supabase.auth.signOut();
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => {
          loadRoles(sess.user.id);
          conferirAcesso(sess.user.id);
        }, 0);
      } else {
        setRoles([]);
      }
    });

    supabase.auth
      .getSession()
      .then(({ data: { session: sess } }) => {
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) {
          loadRoles(sess.user.id);
          conferirAcesso(sess.user.id);
        }
      })
      .catch((e) => {
        // Sem este catch, uma rejeição aqui deixava `loading` em true para
        // sempre e o app ficava preso no spinner do ProtectedRoute.
        console.error("[AuthContext] falha ao recuperar a sessão:", e);
      })
      .finally(() => setLoading(false));

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, roles, loading, isAdmin: roles.includes("admin"), signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
