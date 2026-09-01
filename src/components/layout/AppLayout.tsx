import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { AIAssistant } from "@/components/AIAssistant";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function AppLayout() {
  const { user, signOut, isAdmin } = useAuth();
  const location = useLocation();
  const hideAssistant = location.pathname.startsWith("/conversas");

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-orbs">
        {/* A sidebar tem muitos itens antes do conteúdo; sem isso, quem navega
            por teclado percorre o menu inteiro em cada troca de página. */}
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 glass border-b border-border">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div>
                <div className="text-xs text-muted-foreground">Bem-vinda</div>
                <div className="text-sm font-medium truncate max-w-[180px] md:max-w-none">
                  {user?.email}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex text-xs px-3 py-1 rounded-full bg-gradient-primary text-primary-foreground font-medium">
                {isAdmin ? "Admin" : "Vendedor"}
              </span>
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <main id="conteudo" tabIndex={-1} className="flex-1 p-4 md:p-6 overflow-auto">
            {/* Um erro numa página não deve derrubar a aplicação inteira:
                a barreira por rota mantém sidebar e cabeçalho de pé. */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>

        {!hideAssistant && <AIAssistant />}
      </div>
    </SidebarProvider>
  );
}
