import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import Receivable from "./pages/Receivable";
import Payable from "./pages/Payable";
import WhatsApp from "./pages/WhatsApp";
import Conversations from "./pages/Conversations";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/clientes" element={<Customers />} />
                <Route path="/clientes/:id" element={<CustomerDetail />} />
                <Route path="/estoque" element={<Inventory />} />
                <Route path="/vendas" element={<Sales />} />
                <Route path="/contas-receber" element={<Receivable />} />
                <Route path="/contas-pagar" element={<Payable />} />
                <Route path="/conversas" element={<Conversations />} />
                <Route path="/whatsapp" element={<WhatsApp />} />
              </Route>
              <Route element={<ProtectedRoute adminOnly />}>
                <Route element={<AppLayout />}>
                  <Route path="/usuarios" element={<Users />} />
                  <Route path="/configuracoes" element={<Settings />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
