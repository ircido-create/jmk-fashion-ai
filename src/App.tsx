import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageSkeleton } from "@/components/layout/PageSkeleton";

// Rotas críticas de autenticação — carregadas de imediato (bundle pequeno).
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound.tsx";

// Demais rotas via code-splitting (lazy) — cada página vira um chunk próprio.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Sales = lazy(() => import("./pages/Sales"));
const POS = lazy(() => import("./pages/POS"));
const Receivable = lazy(() => import("./pages/Receivable"));
const Payable = lazy(() => import("./pages/Payable"));
const WhatsApp = lazy(() => import("./pages/WhatsApp"));
const Conversations = lazy(() => import("./pages/Conversations"));
const Status = lazy(() => import("./pages/Status"));
const PreSales = lazy(() => import("./pages/PreSales"));
const PreSaleForm = lazy(() => import("./pages/PreSaleForm"));
const PreSaleDetail = lazy(() => import("./pages/PreSaleDetail"));
const Users = lazy(() => import("./pages/Users"));
const Settings = lazy(() => import("./pages/Settings"));
const Install = lazy(() => import("./pages/Install"));
const Reports = lazy(() => import("./pages/Reports"));
const PaymentProofs = lazy(() => import("./pages/PaymentProofs"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/clientes" element={<Customers />} />
                    <Route path="/clientes/:id" element={<CustomerDetail />} />
                    <Route path="/estoque" element={<Inventory />} />
                    <Route path="/vendas" element={<Sales />} />
                    <Route path="/pdv" element={<POS />} />
                    <Route path="/contas-receber" element={<Receivable />} />
                    <Route path="/contas-pagar" element={<Payable />} />
                    <Route path="/conversas" element={<Conversations />} />
                    <Route path="/status" element={<Status />} />
                    <Route path="/pre-vendas" element={<PreSales />} />
                    <Route path="/pre-vendas/nova" element={<PreSaleForm />} />
                    <Route path="/pre-vendas/:id/editar" element={<PreSaleForm />} />
                    <Route path="/pre-vendas/:id" element={<PreSaleDetail />} />
                    <Route path="/whatsapp" element={<WhatsApp />} />
                    <Route path="/relatorios" element={<Reports />} />
                    <Route path="/comprovantes" element={<PaymentProofs />} />
                    <Route path="/instalar" element={<Install />} />
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
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
