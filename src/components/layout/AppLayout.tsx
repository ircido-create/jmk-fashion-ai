import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { AIAssistant } from "@/components/AIAssistant";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppLayout() {
  const { user, signOut, isAdmin } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-orbs">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 glass border-b border-white/30">
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
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>

        <AIAssistant />
      </div>
    </SidebarProvider>
  );
}
