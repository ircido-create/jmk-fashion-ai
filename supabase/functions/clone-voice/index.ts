// Clona uma voz no ElevenLabs (Instant Voice Cloning) e salva no banco.
// Recebe: multipart/form-data com `name`, `description?`, e 1+ arquivos `audio`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY ausente");

    // Auth: precisa estar logado e ser admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const supaAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await supaAuth.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: isAdmin } = await supa.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas admins podem clonar vozes" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const setActive = form.get("activate") === "true";

    if (!name) {
      return new Response(JSON.stringify({ error: "Nome é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const files = form.getAll("audio").filter((v) => v instanceof File) as File[];
    if (files.length === 0) {
      return new Response(JSON.stringify({ error: "Envie pelo menos um arquivo de áudio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Limite total: 25MB (limite ElevenLabs Instant Cloning)
    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Áudio total acima de 25MB" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Envia para ElevenLabs Voice Cloning API
    const elevenForm = new FormData();
    elevenForm.append("name", name);
    if (description) elevenForm.append("description", description);
    for (const f of files) {
      elevenForm.append("files", f, f.name);
    }
    // Labels úteis para identificar a voz (PT-BR feminina madura)
    elevenForm.append("labels", JSON.stringify({
      language: "pt-br",
      gender: "female",
      use_case: "conversational",
    }));

    const elevenRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: elevenForm,
    });

    const elevenJson = await elevenRes.json();
    if (!elevenRes.ok) {
      console.error("ElevenLabs add voice error:", elevenRes.status, elevenJson);
      return new Response(JSON.stringify({
        error: elevenJson?.detail?.message || elevenJson?.detail || "Erro ao clonar voz no ElevenLabs",
        status: elevenRes.status,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const voiceId = elevenJson.voice_id as string;
    if (!voiceId) {
      return new Response(JSON.stringify({ error: "ElevenLabs não retornou voice_id" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Salva uma amostra no Storage (apenas o primeiro arquivo, para preview)
    let samplePath: string | null = null;
    try {
      const first = files[0];
      const ext = (first.name.split(".").pop() || "mp3").toLowerCase();
      samplePath = `${voiceId}/sample.${ext}`;
      const buf = new Uint8Array(await first.arrayBuffer());
      await supa.storage.from("voice-samples").upload(samplePath, buf, {
        contentType: first.type || "audio/mpeg",
        upsert: true,
      });
    } catch (e) {
      console.warn("Falha ao salvar amostra (não bloqueante):", e);
    }

    // 3) Se vai ativar, desativa as outras antes
    if (setActive) {
      await supa.from("voice_clones").update({ is_active: false }).eq("is_active", true);
    }

    // 4) Insere no banco
    const { data: inserted, error: insErr } = await supa.from("voice_clones").insert({
      name,
      voice_id: voiceId,
      description: description || null,
      sample_storage_path: samplePath,
      is_active: setActive,
      created_by: user.id,
    }).select().single();

    if (insErr) {
      console.error("Insert voice_clones error:", insErr);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, voice: inserted }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("clone-voice error:", e);
    const msg = e instanceof Error ? e.message : "Erro inesperado";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
