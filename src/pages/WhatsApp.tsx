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
import { MessageSquare, Save, Send, Sparkles, Copy, Check, AlertTriangle, Settings, Activity, RefreshCw, Wifi, WifiOff } from "lucide-react";

// As credenciais da Meta (access_token, phone_number_id, waba_id, app_secret,
// verify_token) sairam junto com a integracao Cloud API. As colunas continuam no
// banco, mas nada mais as le nem escreve. O envio hoje e todo BubbleWhats, com
// device e token vindos de variaveis de ambiente das edge functions.
interface Config {
  id?: string;
  last_error_at?: string | null;
  last_error_message?: string | null;
}

interface AISettings {
  id?: string;
  persona: string;
  system_prompt: string;
  ai_paused?: boolean;
}

interface BlockedContact {
  id: string;
  phone: string;
  note: string | null;
}

export default function WhatsApp() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<Config>({});
  const [ai, setAI] = useState<AISettings>({ persona: "amigavel", system_prompt: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Olá! Mensagem de teste da JMK 💕");
  const [copied, setCopied] = useState(false);
  const [configuringGroups, setConfiguringGroups] = useState(false);
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  const [newBlockedPhone, setNewBlockedPhone] = useState("");
  const [newBlockedNote, setNewBlockedNote] = useState("");
  const [diag, setDiag] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [lastInboundAt, setLastInboundAt] = useState<string | null>(null);
  const [avgDelayMin, setAvgDelayMin] = useState<number | null>(null);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/bubblewhats-webhook`;

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: a }, { data: bl }, { data: lm }, { data: delays }] = await Promise.all([
      supabase.from("whatsapp_config").select("*").maybeSingle(),
      supabase.from("ai_settings").select("*").maybeSingle(),
      supabase.from("ai_blocked_contacts").select("id, phone, note").order("created_at", { ascending: false }),
      supabase.from("whatsapp_messages").select("created_at").eq("direction", "inbound")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("whatsapp_messages").select("created_at, sent_at").eq("direction", "inbound")
        .not("sent_at", "is", null).order("created_at", { ascending: false }).limit(20),
    ]);
    if (c) setCfg(c as any);
    if (a) setAI(a as any);
    setBlocked((bl ?? []) as BlockedContact[]);
    setLastInboundAt((lm as any)?.created_at ?? null);
    const rows = (delays ?? []) as { created_at: string; sent_at: string }[];
    setAvgDelayMin(
      rows.length
        ? rows.reduce((s, r) => s + (new Date(r.created_at).getTime() - new Date(r.sent_at).getTime()) / 60000, 0) / rows.length
        : null,
    );
    setLoading(false);
  };


  const runDiagnostics = async () => {
    setChecking(true);
    const { data, error } = await supabase.functions.invoke("bubblewhats-status", { body: {} });
    setChecking(false);
    if (error || (data as any)?.error) {
      toast({
        title: "Falha ao verificar conexão",
        description: error?.message ?? (data as any)?.error,
        variant: "destructive",
      });
      return;
    }
    setDiag(data);
    if ((data as any)?.lastInboundAt) setLastInboundAt((data as any).lastInboundAt);
  };

  const hoursSinceInbound = lastInboundAt
    ? (Date.now() - new Date(lastInboundAt).getTime()) / 3600000
    : null;
  const inactive = hoursSinceInbound === null || hoursSinceInbound > 6;


  const toggleAIPaused = async (value: boolean) => {
    setAI({ ...ai, ai_paused: value });
    if (!ai.id) return;
    const { error } = await supabase.from("ai_settings").update({ ai_paused: value }).eq("id", ai.id);
    if (error) {
      toast({ title: "Erro ao alterar pausa", description: error.message, variant: "destructive" });
    } else {
      toast({ title: value ? "Mônica pausada — não responderá ninguém" : "Mônica reativada 💕" });
    }
  };

  const addBlocked = async () => {
    const phone = newBlockedPhone.replace(/\D/g, "");
    if (!phone) return;
    const { error } = await supabase.from("ai_blocked_contacts").insert({
      phone, note: newBlockedNote.trim() || null,
    });
    if (error) {
      toast({ title: "Erro ao adicionar", description: error.message, variant: "destructive" });
      return;
    }
    setNewBlockedPhone(""); setNewBlockedNote("");
    toast({ title: "Contato adicionado à lista de silêncio" });
    load();
  };

  const removeBlocked = async (id: string) => {
    const { error } = await supabase.from("ai_blocked_contacts").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  useEffect(() => { load(); }, []);

  // whatsapp_config nao e mais salvo aqui: sobraram nela apenas last_error_at e
  // last_error_message, escritos pelas edge functions. Regravar o que foi lido
  // apagaria um erro registrado entre o carregamento da tela e o clique em salvar.
  const save = async () => {
    setSaving(true);
    const aiPayload: any = { ...ai };
    if (!aiPayload.id) delete aiPayload.id;

    const { error } = ai.id
      ? await supabase.from("ai_settings").update(aiPayload).eq("id", ai.id)
      : await supabase.from("ai_settings").insert(aiPayload);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
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

  const configureBubbleWhatsGroups = async () => {
    setConfiguringGroups(true);
    const { data, error } = await supabase.functions.invoke("bubblewhats-configure-groups", {
      body: {},
    });
    setConfiguringGroups(false);
    if (error || (data as any)?.error) {
      toast({
        title: "Falha ao ativar grupos",
        description: error?.message ?? (data as any)?.details ?? (data as any)?.error,
        variant: "destructive",
      });
    } else {
      toast({ title: "Grupos ativados no BubbleWhats ✅" });
    }
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
      <PageHeader title="WhatsApp + IA" description="Atendimento automático via BubbleWhats" />

      {inactive && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 backdrop-blur p-4 flex gap-3 items-start">
          <WifiOff className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-destructive">Possível desconexão do WhatsApp</p>
            <p className="text-xs text-muted-foreground mt-1">
              {lastInboundAt
                ? `Nenhuma mensagem recebida há ${Math.floor(hoursSinceInbound!)}h (última em ${new Date(lastInboundAt).toLocaleString("pt-BR")}).`
                : "Nenhuma mensagem recebida até agora."}{" "}
              Clique em <strong>Verificar conexão</strong> abaixo para diagnosticar.
            </p>
          </div>
        </div>
      )}

      {avgDelayMin !== null && avgDelayMin > 15 && (
        <div className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 backdrop-blur p-4 flex gap-3 items-start">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Mensagens chegando com atraso</p>
            <p className="text-xs text-muted-foreground mt-1">
              As últimas mensagens levaram em média{" "}
              <strong>
                {avgDelayMin >= 60
                  ? `${(avgDelayMin / 60).toFixed(1)} h`
                  : `${Math.round(avgDelayMin)} min`}
              </strong>{" "}
              para chegar até o sistema — fila de entrega do provedor BubbleWhats. A Mônica só
              consegue responder depois que a mensagem chega.
            </p>
          </div>
        </div>
      )}


      <GlassCard>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-display font-bold">Diagnóstico da conexão</h2>
          </div>
          <div className="flex gap-2">
            <Button onClick={runDiagnostics} disabled={checking} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Verificando…" : "Verificar conexão"}
            </Button>
            <Button onClick={configureBubbleWhatsGroups} disabled={configuringGroups} variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              {configuringGroups ? "Reconfigurando…" : "Reconfigurar webhook"}
            </Button>
          </div>
        </div>

        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            {lastInboundAt && !inactive ? <Wifi className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
            <span>
              Última mensagem recebida:{" "}
              <strong>{lastInboundAt ? new Date(lastInboundAt).toLocaleString("pt-BR") : "nunca"}</strong>
            </span>
          </li>
          {diag && (
            <>
              <li className="flex items-center gap-2">
                {diag.tokenValid === true ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : diag.tokenValid === false ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                )}
                <span>
                  Token:{" "}
                  <strong>
                    {diag.tokenValid === true
                      ? "válido"
                      : diag.tokenValid === false
                        ? "inválido ou expirado — salve novamente o token do painel do BubbleWhats"
                        : "provedor indisponível — tente de novo em alguns minutos"}
                  </strong>
                </span>
              </li>
              <li className="flex items-center gap-2">
                {diag.connected ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-destructive" />}
                <span>
                  Aparelho:{" "}
                  <strong>{diag.connected ? "conectado" : "desconectado — releia o QR Code no painel do BubbleWhats"}</strong>
                  {diag.rawState ? ` (${diag.rawState})` : ""}
                </span>
              </li>
              <li className="flex items-center gap-2">
                {diag.webhookOk ? <Check className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                <span>
                  Webhook registrado:{" "}
                  <strong>{diag.webhookOk ? "correto" : (diag.registeredWebhook || "não configurado")}</strong>
                  {!diag.webhookOk && " — use “Reconfigurar webhook”"}
                </span>
              </li>
              <li className="flex items-center gap-2">
                {diag.groupsEnabled ? <Check className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                <span>Recebimento de grupos: <strong>{diag.groupsEnabled ? "ativo" : "inativo/desconhecido"}</strong></span>
              </li>
            </>
          )}
          {!diag && (
            <li className="text-xs text-muted-foreground">
              Clique em “Verificar conexão” para consultar o status do aparelho no BubbleWhats.
            </li>
          )}
        </ul>
      </GlassCard>


      {cfg.last_error_at && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 backdrop-blur p-4 flex gap-3 items-start">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-destructive">Falha na resposta automática da IA</p>
            <p className="text-xs text-muted-foreground mt-1">
              Última falha: {new Date(cfg.last_error_at).toLocaleString("pt-BR")}. A Mônica pode não estar
              respondendo às mensagens recebidas. Causas comuns são crédito esgotado ou limite de requisições
              no provedor de IA — veja o detalhe abaixo.
            </p>
            {cfg.last_error_message && (
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Detalhes do erro
                </summary>
                <pre className="text-xs mt-1 p-2 bg-background/50 rounded overflow-x-auto">
                  {cfg.last_error_message}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      <GlassCard>
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <MessageSquare className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">Conexão BubbleWhats</h2>
              <p className="text-xs text-muted-foreground">Webhook e automações do aparelho conectado</p>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/40 backdrop-blur">
          <Label className="text-xs">URL do Webhook BubbleWhats (receiveMessagesWebhook)</Label>
          <div className="flex gap-2 mt-1">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyWebhook} aria-label="Copiar webhook">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={configureBubbleWhatsGroups}
            disabled={configuringGroups}
          >
            <Settings className="h-4 w-4 mr-2" />
            {configuringGroups ? "Ativando…" : "Ativar recebimento de grupos"}
          </Button>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-display font-bold">Personalidade da IA</h2>
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border/50 bg-muted/30 mb-4">
          <div>
            <div className="text-sm font-medium">Pausar Mônica (não responde ninguém)</div>
            <p className="text-xs text-muted-foreground">
              Quando ativo, a IA para de responder mensagens recebidas. As conversas continuam sendo salvas.
            </p>
          </div>
          <Switch checked={!!ai.ai_paused} onCheckedChange={toggleAIPaused} />
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

      <GlassCard>
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-display font-bold">Contatos silenciados</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          A Mônica <strong>nunca</strong> vai responder mensagens destes números — mas elas continuam aparecendo nas conversas para você responder manualmente.
        </p>

        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <Input
            placeholder="Telefone (ex: 5511999999999)"
            value={newBlockedPhone}
            onChange={(e) => setNewBlockedPhone(e.target.value)}
          />
          <Input
            placeholder="Observação (opcional)"
            value={newBlockedNote}
            onChange={(e) => setNewBlockedNote(e.target.value)}
          />
          <Button onClick={addBlocked} variant="outline">Adicionar</Button>
        </div>

        {blocked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum contato silenciado.</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/50">
            {blocked.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <div className="font-mono">{b.phone}</div>
                  {b.note && <div className="text-xs text-muted-foreground">{b.note}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => removeBlocked(b.id)}>Remover</Button>
              </li>
            ))}
          </ul>
        )}
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
