import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(100),
});

const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "Nome muito curto").max(100),
});

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/", { replace: true });
    });
  }, [navigate]);

  const handleForgot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = forgotEmail.trim();
    if (!email) return toast.error("Informe seu e-mail");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Enviamos um link de redefinição para seu e-mail.");
    setForgotOpen(false);
    setForgotEmail("");
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
      return;
    }
    toast.success("Bem-vinda de volta!");
    navigate("/", { replace: true });
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signupSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
      fullName: form.get("fullName"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: parsed.data.fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message.includes("already registered") ? "E-mail já cadastrado" : error.message);
      return;
    }
    toast.success("Conta criada! Você já pode entrar.");
    setTab("login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-orbs">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex h-16 w-16 rounded-2xl bg-gradient-primary items-center justify-center shadow-glow mb-4">
            <Sparkles className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-display font-bold gradient-text">JMK ADM</h1>
          <p className="text-muted-foreground mt-2 text-sm">Gestão moderna para sua loja</p>
        </div>

        <div className="glass-card p-6 md:p-8">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-white/40 backdrop-blur">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="email-l">E-mail</Label>
                  <Input id="email-l" name="email" type="email" required className="glass-input" />
                </div>
                <div>
                  <Label htmlFor="pwd-l">Senha</Label>
                  <Input id="pwd-l" name="password" type="password" required className="glass-input" />
                </div>
                <Button type="submit" disabled={loading} className="w-full bg-gradient-primary hover:opacity-90 text-primary-foreground shadow-glow h-11 rounded-xl">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
                </Button>
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground underline mt-2"
                >
                  Esqueci minha senha
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label htmlFor="name-s">Nome completo</Label>
                  <Input id="name-s" name="fullName" required className="glass-input" />
                </div>
                <div>
                  <Label htmlFor="email-s">E-mail</Label>
                  <Input id="email-s" name="email" type="email" required className="glass-input" />
                </div>
                <div>
                  <Label htmlFor="pwd-s">Senha (mín. 6 caracteres)</Label>
                  <Input id="pwd-s" name="password" type="password" required minLength={6} className="glass-input" />
                </div>
                <Button type="submit" disabled={loading} className="w-full bg-gradient-primary hover:opacity-90 text-primary-foreground shadow-glow h-11 rounded-xl">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar conta"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  O primeiro usuário cadastrado será o administrador.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
