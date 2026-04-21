import { useEffect, useState } from "react";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { MessageSquare, Save, Send, Sparkles, Copy, Check, AlertTriangle } from "lucide-react";

interface Config {
  id?: string;
  enabled: boolean;
  access_token: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  app_secret: string | null;
  verify_token: string | null;
  last_error_at?: string | null;
  last_error_message?: string | null;
}

interface AISettings {
  id?: string;
  persona: string;
  system_prompt: string;
}

export default function WhatsApp() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<Config>({
    enabled: false, access_token: "", phone_number_id: "",
    waba_id: "", app_secret: "", verify_token: "",
  });
  const [ai, setAI] = useState<AISettings>({ persona: "amigavel", system_prompt: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Olá! Mensagem de teste da JMK 💕");
  const [copied, setCopied] = useState(false);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/whatsapp-webhook`;

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from("whatsapp_config").select("*").maybeSingle(),
      supabase.from("ai_settings").select("*").maybeSingle(),
    ]);
    if (c) setCfg(c as any);
    if (a) setAI(a as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    const cfgPayload: any = { ...cfg };
    if (!cfgPayload.id) delete cfgPayload.id;
    const aiPayload: any = { ...ai };
    if (!aiPayload.id) delete aiPayload.id;

    const [r1, r2] = await Promise.all([
      cfg.id
        ? supabase.from("whatsapp_config").update(cfgPayload).eq("id", cfg.id)
        : supabase.from("whatsapp_config").insert(cfgPayload),
      ai.id
        ? supabase.from("ai_settings").update(aiPayload).eq("id", ai.id)
        : supabase.from("ai_settings").insert(aiPayload),
    ]);
    setSaving(false);
    if (r1.error || r2.error) {
      toast({ title: "Erro ao salvar", description: r1.error?.message || r2.error?.message, variant: "destructive" });
    } else {
      toast({ title: "Configurações salvas com sucesso 💕" });
      load();
    }
  };

  const sendTest = async () => {
    if (!testTo) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { to: testTo, message: testMsg },
    });
    if (error || (data as any)?.error) {
      toast({
        title: "Falha no envio",
        description: error?.message ?? JSON.stringify((data as any)?.error),
        variant: "destructive",
      });
    } else {
      toast({ title: "Mensagem enviada! ✅" });
    }
  };

  const runDunning = async () => {
    const { data, error } = await supabase.functions.invoke("dunning-cron");
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else toast({ title: `Cobrança executada`, description: `${(data as any)?.sent ?? 0} mensagens enviadas` });
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="WhatsApp + IA" />
        <GlassCard className="text-center py-12">
          <p className="text-muted-foreground">Apenas administradores podem configurar o WhatsApp.</p>
        </GlassCard>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp + IA" description="Atendimento automático via API Oficial Meta" />

      <GlassCard>
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <MessageSquare className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">Conexão Meta WhatsApp</h2>
              <p className="text-xs text-muted-foreground">API Cloud v21.0 (oficial)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Ativo</Label>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Access Token</Label>
            <Input
              type="password"
              value={cfg.access_token ?? ""}
              onChange={(e) => setCfg({ ...cfg, access_token: e.target.value })}
              placeholder="EAAG..."
            />
          </div>
          <div>
            <Label>Phone Number ID</Label>
            <Input
              value={cfg.phone_number_id ?? ""}
              onChange={(e) => setCfg({ ...cfg, phone_number_id: e.target.value })}
              placeholder="1234567890"
            />
          </div>
          <div>
            <Label>WABA ID</Label>
            <Input
              value={cfg.waba_id ?? ""}
              onChange={(e) => setCfg({ ...cfg, waba_id: e.target.value })}
            />
          </div>
          <div>
            <Label>App Secret</Label>
            <Input
              type="password"
              value={cfg.app_secret ?? ""}
              onChange={(e) => setCfg({ ...cfg, app_secret: e.target.value })}
            />
          </div>
          <div>
            <Label>Verify Token (defina e use no painel da Meta)</Label>
            <Input
              value={cfg.verify_token ?? ""}
              onChange={(e) => setCfg({ ...cfg, verify_token: e.target.value })}
              placeholder="jmk-verify-2024"
            />
          </div>
        </div>

        <div className="mt-6 p-4 rounded-2xl bg-white/40 backdrop-blur">
          <Label className="text-xs">URL do Webhook (cole no painel Meta → Webhooks)</Label>
          <div className="flex gap-2 mt-1">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyWebhook}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-display font-bold">Personalidade da IA</h2>
        </div>
        <div>
          <Label>Prompt do sistema</Label>
          <Textarea
            rows={6}
            value={ai.system_prompt}
            onChange={(e) => setAI({ ...ai, system_prompt: e.target.value })}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-2">
            💡 A IA tem acesso automático ao seu catálogo (preços, tamanhos, cores, estoque) e
            às dívidas do cliente quando reconhece o telefone.
          </p>
        </div>
      </GlassCard>

      <div className="flex gap-3">
        <Button onClick={save} disabled={saving} className="bg-gradient-primary">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>

      <GlassCard>
        <h2 className="text-lg font-display font-bold mb-4">Testes</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Enviar mensagem de teste</h3>
            <Input
              placeholder="Telefone (ex: 5511999999999)"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Textarea rows={3} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
            <Button onClick={sendTest} variant="outline" className="w-full">
              <Send className="h-4 w-4 mr-2" />Enviar teste
            </Button>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Cobrança automática</h3>
            <p className="text-xs text-muted-foreground">
              Roda diariamente às 10h. Envia mensagem cordial a clientes com contas vencidas.
              Use o botão abaixo para executar manualmente.
            </p>
            <Button onClick={runDunning} variant="outline" className="w-full">
              ⏰ Executar cobrança agora
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
