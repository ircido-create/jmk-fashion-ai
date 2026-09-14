/** ajustar o sistema para que o envio automático ocorra rigorosamente às 10:00 da manhã no horário de Brasília */
import { Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
const ReceivableReports = lazy(() => import("./pages/ReceivableReports"));
const StoreOrders = lazy(() => import("./pages/StoreOrders"));

// Loja virtual — módulo público, com layout e tema próprios. Fica em /loja para
// não mexer em nenhum endereço do administrativo.
const StoreLayout = lazy(() => import("./store/StoreLayout"));
const StoreHome = lazy(() => import("./store/pages/StoreHome"));
const StoreProduct = lazy(() => import("./store/pages/StoreProduct"));
const StoreFittingRoom = lazy(() => import("./store/pages/StoreFittingRoom"));
const StoreCart = lazy(() => import("./store/pages/StoreCart"));
const StoreOrderDone = lazy(() => import("./store/pages/StoreOrderDone"));
// Enquanto o bundle da loja baixa, o fallback geral mostraria o esqueleto claro
// do administrativo para o visitante. Um fundo no tom da loja evita o clarão.
const StoreBootFallback = () => <div style={{ minHeight: "100vh", background: "#0b0b0e" }} aria-busy="true" />;

const App = () => (
  <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route
                  path="/loja"
                  element={
                    <Suspense fallback={<StoreBootFallback />}>
                      <StoreLayout />
                    </Suspense>
                  }
                >
                  <Route index element={<StoreHome />} />
                  <Route path="produto/:id" element={<StoreProduct />} />
                  <Route path="provador" element={<StoreFittingRoom />} />
                  <Route path="carrinho" element={<StoreCart />} />
                  <Route path="pedido/:code" element={<StoreOrderDone />} />
                </Route>
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
                    <Route path="/relatorios/contas-receber" element={<ReceivableReports />} />
                    <Route path="/comprovantes" element={<PaymentProofs />} />
                    <Route path="/pedidos-loja" element={<StoreOrders />} />
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
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </ThemeProvider>
);

export default App;
