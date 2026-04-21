import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function Settings() {
  const [prompt, setPrompt] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("ai_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) { setId(data.id); setPrompt(data.system_prompt); }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = id
      ? await supabase.from("ai_settings").update({ system_prompt: prompt }).eq("id", id)
      : await supabase.from("ai_settings").insert({ system_prompt: prompt });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Personalidade da IA salva");
  };

  return (
    <div>
      <PageHeader title="Configurações" description="Personalidade da IA e ajustes do sistema" />

      <GlassCard>
        <Label className="text-base font-semibold">Prompt da IA (atendimento WhatsApp)</Label>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Define como a assistente conversa com seus clientes.
          A regra "Amém" para mensagens de paz, e o uso do estoque/dívidas, já estão incluídos por padrão.
        </p>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              className="glass-input font-mono text-xs"
            />
            <Button onClick={save} disabled={saving} className="mt-3 bg-gradient-primary text-primary-foreground rounded-xl">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </>
        )}
      </GlassCard>
    </div>
  );
}
