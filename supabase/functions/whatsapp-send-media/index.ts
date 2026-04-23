// Envio de mídia (imagem, áudio, documento) pelo painel via Meta Cloud API.
// Recebe arquivo em base64, salva no bucket whatsapp-media, sobe na Meta e envia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MediaKind = "image" | "audio" | "document" | "sticker";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extFromMime(mime: string, fallback = "bin"): string {
  const m: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/webm": "webm",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  return m[mime] ?? fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const to: string = String(body.to ?? "").replace(/\D/g, "");
    const kind: MediaKind = body.kind;
    const fileBase64: string = body.file_base64;
    const mimeType: string = body.mime_type;
    const filename: string | undefined = body.filename;
    const caption: string | undefined = body.caption;

    if (!to || !kind || !fileBase64 || !mimeType) {
      return new Response(JSON.stringify({ error: "to, kind, file_base64, mime_type obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["image", "audio", "document", "sticker"].includes(kind)) {
      return new Response(JSON.stringify({ error: "kind inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: cfg } = await admin.from("whatsapp_config").select("*").maybeSingle();
    if (!cfg?.enabled || !cfg.access_token || !cfg.phone_number_id) {
      return new Response(JSON.stringify({ error: "WhatsApp não configurado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Salva no storage
    const bytes = base64ToBytes(fileBase64);
    const ext = extFromMime(mimeType, kind === "image" ? "jpg" : kind === "audio" ? "ogg" : "bin");
    const safeName = filename?.replace(/[^\w.-]/g, "_") ?? `file.${ext}`;
    const storagePath = `outbound/${to}/${Date.now()}-${safeName}`;
    const { error: upErr } = await admin.storage
      .from("whatsapp-media")
      .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (upErr) {
      console.error("storage upload error:", upErr);
      return new Response(JSON.stringify({ error: "Falha ao salvar arquivo" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Upload para Meta /media
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([bytes], { type: mimeType }), safeName);

    const upMeta = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.access_token}` },
      body: form,
    });
    if (!upMeta.ok) {
      const t = await upMeta.text();
      console.error("Meta media upload error:", upMeta.status, t);
      return new Response(JSON.stringify({ error: `Meta upload falhou: ${t}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const upJson = await upMeta.json();
    const mediaId = upJson.id;

    // 3) Envia mensagem
    const payload: any = {
      messaging_product: "whatsapp",
      to,
      type: kind,
    };
    if (kind === "image") {
      payload.image = { id: mediaId };
      if (caption) payload.image.caption = caption.slice(0, 1024);
    } else if (kind === "audio") {
      payload.audio = { id: mediaId };
    } else if (kind === "document") {
      payload.document = { id: mediaId, filename: safeName };
      if (caption) payload.document.caption = caption.slice(0, 1024);
    } else if (kind === "sticker") {
      payload.sticker = { id: mediaId };
    }

    const sendRes = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const sendJson = await sendRes.json();
    if (!sendRes.ok) {
      console.error("Meta send error:", sendRes.status, sendJson);
      return new Response(JSON.stringify({ error: sendJson }), {
        status: sendRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Salva histórico
    let { data: conv } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("customer_phone", to)
      .maybeSingle();
    if (!conv) {
      const { data: customer } = await admin
        .from("customers").select("id").eq("phone", to).maybeSingle();
      const { data: created } = await admin
        .from("whatsapp_conversations")
        .insert({ customer_phone: to, customer_id: customer?.id ?? null })
        .select().single();
      conv = created;
    }
    if (conv) {
      const labelByKind: Record<MediaKind, string> = {
        image: "[📷 Imagem]",
        audio: "[🎤 Áudio]",
        document: "[📎 Documento]",
        sticker: "[🌟 Figurinha]",
      };
      await admin.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        direction: "outbound",
        content: caption?.trim() ? caption : labelByKind[kind],
        media_path: storagePath,
        media_type: kind,
        media_mime: mimeType,
        media_filename: safeName,
      });
      await admin.from("whatsapp_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conv.id);
    }

    return new Response(JSON.stringify({ success: true, result: sendJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("whatsapp-send-media error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
