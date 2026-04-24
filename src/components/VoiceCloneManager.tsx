import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Mic, Trash2, CheckCircle2, Upload, Play } from "lucide-react";

type VoiceClone = {
  id: string;
  name: string;
  voice_id: string;
  description: string | null;
  sample_storage_path: string | null;
  is_active: boolean;
  created_at: string;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function VoiceCloneManager() {
  const [voices, setVoices] = useState<VoiceClone[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Mônica (loja)");
  const [description, setDescription] = useState(
    "Voz da Mônica, dona da JMK Modas — feminina, madura, sotaque brasileiro natural."
  );
  const [files, setFiles] = useState<File[]>([]);
  const [activate, setActivate] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("voice_clones")
      .select("*")
      .order("created_at", { ascending: false });
    setVoices((data ?? []) as VoiceClone[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const totalMb = files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024);

  const submit = async () => {
    if (!name.trim()) return toast.error("Informe um nome para a voz");
    if (files.length === 0) return toast.error("Selecione pelo menos 1 arquivo de áudio");
    if (totalMb > 25) return toast.error("Áudio total acima de 25MB");

    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Faça login novamente");

      const form = new FormData();
      form.append("name", name);
      form.append("description", description);
      form.append("activate", activate ? "true" : "false");
      for (const f of files) form.append("audio", f, f.name);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/clone-voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha ao clonar voz");

      toast.success(`Voz "${json.voice.name}" clonada com sucesso!`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setUploading(false);
    }
  };

  const activate_ = async (id: string) => {
    const { error: e1 } = await supabase
      .from("voice_clones")
      .update({ is_active: false })
      .eq("is_active", true);
    if (e1) return toast.error(e1.message);
    const { error } = await supabase.from("voice_clones").update({ is_active: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Voz ativada — Mônica vai usar essa voz nas próximas respostas");
    load();
  };

  const remove = async (v: VoiceClone) => {
    if (!confirm(`Excluir voz "${v.name}"? (Não remove do ElevenLabs, só daqui.)`)) return;
    if (v.sample_storage_path) {
      await supabase.storage.from("voice-samples").remove([v.sample_storage_path]);
    }
    const { error } = await supabase.from("voice_clones").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    toast.success("Voz removida");
    load();
  };

  const sampleUrl = (path: string | null) =>
    path ? `${SUPABASE_URL}/storage/v1/object/public/voice-samples/${path}` : null;

  return (
    <GlassCard className="mt-4">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <Label className="text-base font-semibold">Voz da Mônica (clonagem ElevenLabs)</Label>
      </div>
      <p className="text-xs text-muted-foreground mt-1 mb-4">
        Faça upload de 1 a 3 minutos de áudio limpo da Mônica falando (sem música, sem eco).
        A voz clonada será usada nas respostas em áudio do WhatsApp.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">Nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass-input mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Arquivos de áudio (mp3, wav, m4a, ogg)</Label>
          <Input
            ref={inputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="glass-input mt-1"
          />
          {files.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {files.length} arquivo(s) — {totalMb.toFixed(1)}MB
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs">Descrição (opcional)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="glass-input mt-1 text-xs"
          />
        </div>
        <label className="md:col-span-2 flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
          />
          Ativar imediatamente após clonar (Mônica passa a usar essa voz)
        </label>
      </div>

      <Button
        onClick={submit}
        disabled={uploading || files.length === 0}
        className="mt-4 bg-gradient-primary text-primary-foreground rounded-xl"
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Clonando voz...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" /> Clonar voz
          </>
        )}
      </Button>

      {/* Lista de vozes existentes */}
      <div className="mt-6">
        <Label className="text-sm font-semibold">Vozes clonadas</Label>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary mt-2" />
        ) : voices.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">
            Nenhuma voz clonada ainda. Suba um áudio acima para começar.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {voices.map((v) => {
              const url = sampleUrl(v.sample_storage_path);
              return (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{v.name}</span>
                      {v.is_active && (
                        <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/40">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Ativa
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {v.voice_id}
                    </p>
                    {v.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                        {v.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <Play className="h-3 w-3" /> Amostra
                      </a>
                    )}
                    {!v.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => activate_(v.id)}
                        className="h-7 text-xs"
                      >
                        Ativar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(v)}
                      className="h-7 w-7 p-0 text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
