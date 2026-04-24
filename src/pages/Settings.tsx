import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { VoiceCloneManager } from "@/components/VoiceCloneManager";

const PIX_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "telefone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "aleatoria", label: "Chave aleatória" },
];

export default function Settings() {
  const [prompt, setPrompt] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState("");
  const [pixRecipient, setPixRecipient] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("ai_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) {
        setId(data.id);
        setPrompt(data.system_prompt);
        setPixKey(data.pix_key ?? "");
        setPixKeyType(data.pix_key_type ?? "");
        setPixRecipient(data.pix_recipient_name ?? "");
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const payload = {
      system_prompt: prompt,
      pix_key: pixKey || null,
      pix_key_type: pixKeyType || null,
      pix_recipient_name: pixRecipient || null,
    };
    const { error } = id
      ? await supabase.from("ai_settings").update(payload).eq("id", id)
      : await supabase.from("ai_settings").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Configurações salvas");
  };

  return (
    <div>
      <PageHeader title="Configurações" description="Personalidade da IA, PIX e ajustes do sistema" />

      <GlassCard>
        <Label className="text-base font-semibold">Prompt da IA (atendimento WhatsApp)</Label>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Define como a assistente conversa com seus clientes.
          A regra "Amém" para mensagens de paz, e o uso do estoque/dívidas, já estão incluídos por padrão.
        </p>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            className="glass-input font-mono text-xs"
          />
        )}
      </GlassCard>

      <GlassCard className="mt-4">
        <Label className="text-base font-semibold">Chave PIX para recebimento</Label>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Quando a cliente disser que quer pagar, a Monica vai sugerir PIX e enviar esta chave automaticamente.
        </p>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Tipo da chave</Label>
              <Select value={pixKeyType} onValueChange={setPixKeyType}>
                <SelectTrigger className="glass-input mt-1">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {PIX_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Chave PIX</Label>
              <Input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder="ex: 12345678900 ou email@dominio.com"
                className="glass-input mt-1"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Nome do recebedor (opcional)</Label>
              <Input
                value={pixRecipient}
                onChange={(e) => setPixRecipient(e.target.value)}
                placeholder="ex: Maria da Silva / JMK Modas"
                className="glass-input mt-1"
              />
            </div>
          </div>
        )}
      </GlassCard>

      <VoiceCloneManager />

      <Button
        onClick={save}
        disabled={saving || loading}
        className="mt-4 bg-gradient-primary text-primary-foreground rounded-xl"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar configurações"}
      </Button>
    </div>
  );
}
