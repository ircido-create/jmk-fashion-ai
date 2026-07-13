import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Package, ArrowDownCircle, ArrowUpCircle,
  MessageSquare, MessageCircle, UserCog, Settings, Sparkles, ShoppingBag, Smartphone, ScanLine, Camera, FileBarChart2, Receipt
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar, SidebarHeader,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const mainItems = [
  { title: "Painel", url: "/", icon: LayoutDashboard },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Estoque", url: "/estoque", icon: Package },
  { title: "PDV / Caixa", url: "/pdv", icon: ScanLine },
  { title: "Pré-Vendas", url: "/pre-vendas", icon: Camera },
  { title: "Vendas", url: "/vendas", icon: ShoppingBag },
  { title: "Contas a Pagar", url: "/contas-pagar", icon: ArrowDownCircle },
  { title: "Contas a Receber", url: "/contas-receber", icon: ArrowUpCircle },
  { title: "Comprovantes", url: "/comprovantes", icon: Receipt },
  
  { title: "Relatório Contas a Receber", url: "/relatorios/contas-receber", icon: FileBarChart2 },
  { title: "Status do Dia", url: "/status", icon: Camera },
  { title: "Conversas", url: "/conversas", icon: MessageCircle },
  { title: "WhatsApp IA", url: "/whatsapp", icon: MessageSquare },
  { title: "Instalar no celular", url: "/instalar", icon: Smartphone },
];

const adminItems = [
  { title: "Usuários", url: "/usuarios", icon: UserCog },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isAdmin } = useAuth();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all duration-200",
      active
        ? "bg-gradient-primary text-primary-foreground shadow-glow font-medium"
        : "hover:bg-sidebar-accent text-sidebar-foreground"
    );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar/60 backdrop-blur-xl">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <div className="font-display font-bold text-lg leading-tight gradient-text">JMK</div>
              <div className="text-[10px] text-muted-foreground tracking-widest">ADM</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === "/"}>
                      {({ isActive: a }) => (
                        <div className={linkClass(a)}>
                          <item.icon className="h-5 w-5 shrink-0" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </div>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url}>
                        {({ isActive: a }) => (
                          <div className={linkClass(a)}>
                            <item.icon className="h-5 w-5 shrink-0" />
                            {!collapsed && <span className="text-sm">{item.title}</span>}
                          </div>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
