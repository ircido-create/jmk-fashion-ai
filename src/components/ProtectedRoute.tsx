import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ adminOnly = false }: { adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Sem login, a página inicial do domínio é a loja virtual: o visitante que
  // digita www.jmkmodas.com.br é cliente, não equipe. As demais telas internas
  // (links e favoritos da equipe) continuam levando ao login.
  if (!user) return <Navigate to={location.pathname === "/" ? "/loja" : "/auth"} replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  return <Outlet />;
}
