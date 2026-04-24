// WhatsApp webhook (Meta Cloud API) - recebe mensagens e responde com a IA Monica (RAG)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const STOPWORDS = new Set([
  "a","o","as","os","de","da","do","das","dos","e","ou","um","uma","para","por","com","sem",
  "que","qual","quais","quanto","quanta","quantas","quantos","tem","ter","tenho","queria",
  "quero","gostaria","poderia","pode","me","mim","meu","minha","seu","sua","no","na","nos","nas",
  "em","ao","aos","à","às","é","são","ser","estar","está","estão","ola","olá","oi","bom","boa",
  "dia","tarde","noite","obrigado","obrigada","por favor","favor","vc","você","voce","preço",
  "preco","valor","custo","quanto","ai","aí","la","lá","aqui","esse","essa","esses","essas",
  "isso","isto","aquilo","já","ainda","só","so","mais","menos","muito","pouco","sim","não","nao"
]);

// Reduz diminutivos/aumentativos pt-BR para a raiz, p/ casar "blusinha" com "BLUSA".
// Só aplica se a raiz resultante tiver >= 4 letras, pra não virar coisa nada-a-ver.
function stemPtBr(word: string): string {
  const suffixes = ["zinhas", "zinhos", "zinha", "zinho", "inhas", "inhos", "inha", "inho", "ona", "onas", "ao", "oes"];
  for (const suf of suffixes) {
    if (word.endsWith(suf) && word.length - suf.length >= 4) {
      return word.slice(0, -suf.length);
    }
  }
  return word;
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stemPtBr)
    .slice(0, 8);
}

async function loadConfig() {
  const { data } = await supabase.from("whatsapp_config").select("*").maybeSingle();
  return data;
}

async function loadAISettings() {
  const { data } = await supabase.from("ai_settings").select("*").maybeSingle();
  return data;
}

// Registra falha de auth (token expirado) na tabela de config
async function recordMetaError(status: number, body: string) {
  try {
    const isAuth = status === 401 || /OAuthException|expired|access token/i.test(body);
    if (!isAuth) return;
    const msg = body.slice(0, 500);
    await supabase
      .from("whatsapp_config")
      .update({ last_error_at: new Date().toISOString(), last_error_message: msg })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    console.error("⚠️ TOKEN WHATSAPP EXPIRADO/INVÁLIDO — atualize em Configurações → WhatsApp");
  } catch (e) {
    console.error("recordMetaError failed:", e);
  }
}

// Limpa marca de erro quando uma chamada à Meta volta a funcionar
async function clearMetaError() {
  try {
    await supabase
      .from("whatsapp_config")
      .update({ last_error_at: null, last_error_message: null })
      .not("last_error_at", "is", null);
  } catch {
    /* noop */
  }
}

// Baixa um media do WhatsApp Cloud API e retorna { bytes, base64, mimeType }
async function downloadWhatsAppMedia(mediaId: string, cfg: any): Promise<{ bytes: Uint8Array; base64: string; mimeType: string } | null> {
  try {
    // 1) pega URL temporária
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    if (!metaRes.ok) {
      const errBody = await metaRes.text();
      console.error("media meta error:", metaRes.status, errBody);
      await recordMetaError(metaRes.status, errBody);
      return null;
    }
    const meta = await metaRes.json();
    const mediaUrl = meta?.url;
    const mimeType = meta?.mime_type ?? "application/octet-stream";
    if (!mediaUrl) return null;

    // 2) baixa o binário
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
    });
    if (!fileRes.ok) {
      console.error("media file error:", fileRes.status);
      return null;
    }
    const buf = await fileRes.arrayBuffer();

    // 3) converte para base64 em chunks (evita stack overflow)
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
    }
    const base64 = btoa(binary);
    return { bytes, base64, mimeType };
  } catch (e) {
    console.error("downloadWhatsAppMedia error:", e);
    return null;
  }
}

function inboundExt(mime: string): string {
  const m: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/webm": "webm",
    "application/pdf": "pdf",
    "video/mp4": "mp4", "video/3gpp": "3gp",
  };
  return m[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}

// Salva mídia recebida no bucket whatsapp-media e retorna o storage path
async function saveInboundMedia(
  bytes: Uint8Array,
  mimeType: string,
  fromPhone: string,
  suggestedName?: string,
): Promise<string | null> {
  try {
    const ext = inboundExt(mimeType);
    const safe = suggestedName?.replace(/[^\w.-]/g, "_") ?? `file.${ext}`;
    const finalName = safe.includes(".") ? safe : `${safe}.${ext}`;
    const path = `inbound/${fromPhone}/${Date.now()}-${finalName}`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) {
      console.error("saveInboundMedia upload error:", error);
      return null;
    }
    return path;
  } catch (e) {
    console.error("saveInboundMedia error:", e);
    return null;
  }
}

// Transcreve áudio usando Lovable AI (Gemini multimodal)
async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva fielmente este áudio em português brasileiro. Responda APENAS com a transcrição, sem comentários, sem aspas, sem prefixos.",
              },
              {
                type: "input_audio",
                input_audio: { data: base64, format: mimeType.includes("mp3") ? "mp3" : "ogg" },
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.error("transcribe error:", resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error("transcribeAudio error:", e);
    return null;
  }
}

async function sendWhatsApp(to: string, text: string, cfg: any) {
  const url = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta send error:", res.status, body);
    await recordMetaError(res.status, body);
  } else {
    await clearMetaError();
  }
}

function inferExtensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mimeType] ?? "jpg";
}

async function uploadMetaMediaFromUrl(imageUrl: string, cfg: any): Promise<string | null> {
  try {
    const normalizedUrl = imageUrl.trim();
    const imageRes = await fetch(normalizedUrl);
    if (!imageRes.ok) {
      console.error("Image download error:", imageRes.status, normalizedUrl);
      return null;
    }

    const mimeType = (imageRes.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith("image/")) {
      console.error("Invalid image content type:", mimeType, normalizedUrl);
      return null;
    }

    const fileBuffer = await imageRes.arrayBuffer();
    const fileNameFromUrl = normalizedUrl.split("/").pop()?.split("?")[0]?.trim();
    const fileName = fileNameFromUrl && fileNameFromUrl.includes(".")
      ? fileNameFromUrl
      : `product-image.${inferExtensionFromMimeType(mimeType)}`;

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);

    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
      },
      body: form,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      console.error("Meta media upload error:", uploadRes.status, "url=", normalizedUrl, body);
      await recordMetaError(uploadRes.status, body);
      return null;
    }

    const uploadData = await uploadRes.json();
    const mediaId = uploadData?.id;
    if (!mediaId) {
      console.error("Meta media upload returned no id:", uploadData);
      return null;
    }

    await clearMetaError();
    return mediaId;
  } catch (e) {
    console.error("uploadMetaMediaFromUrl error:", imageUrl, e);
    return null;
  }
}

async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption: string,
  cfg: any,
  conversationId?: string,
): Promise<boolean> {
  const mediaId = await uploadMetaMediaFromUrl(imageUrl, cfg);
  if (!mediaId) return false;

  const url = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { id: mediaId, caption: caption.slice(0, 1024) },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Meta image send error:", res.status, "mediaId=", mediaId, body);
    await recordMetaError(res.status, body);
    return false;
  }
  await clearMetaError();

  // Registra a imagem enviada como uma mensagem outbound (com media_path)
  // para que apareça no painel de conversa — assim como as figurinhas/áudios.
  if (conversationId) {
    try {
      const imgRes = await fetch(imageUrl.trim());
      if (imgRes.ok) {
        const mime = (imgRes.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
        const fileNameFromUrl = imageUrl.trim().split("/").pop()?.split("?")[0]?.replace(/[^\w.-]/g, "_") ?? `image.${ext}`;
        const finalName = fileNameFromUrl.includes(".") ? fileNameFromUrl : `${fileNameFromUrl}.${ext}`;
        const path = `outbound/${to}/${Date.now()}-image-${finalName}`;
        const { error: upErr } = await supabase.storage
          .from("whatsapp-media")
          .upload(path, buf, { contentType: mime, upsert: false });
        if (upErr) {
          console.error("save outbound image upload error:", upErr);
        } else {
          const { error: insErr } = await supabase.from("whatsapp_messages").insert({
            conversation_id: conversationId,
            direction: "outbound",
            content: caption?.trim() ? caption : "[📷 Imagem]",
            media_path: path,
            media_type: "image",
            media_mime: mime,
            media_filename: finalName,
          });
          if (insErr) console.error("insert outbound image msg error:", insErr);
        }
      } else {
        console.error("download image for storage failed:", imgRes.status, imageUrl);
      }
    } catch (e) {
      console.error("registerOutboundImage error:", e);
    }
  }

  return true;
}

// Detecta se a cliente pediu foto/imagem
function asksForPhoto(text: string): boolean {
  const t = norm(text);
  return /(foto|fotos|imagem|imagens|figura|me manda.*foto|tem foto|tem imagem|posso ver|me mostra|manda.*foto)/.test(t);
}

// Frases genéricas de "me manda foto/de novo" — sem produto específico.
// Também considera genérico quando só sobram pronomes ("dela", "dele", "disso"...),
// porque nesse caso o produto está implícito no histórico da conversa.
function isGenericPhotoRequest(text: string): boolean {
  const t = norm(text);
  // Remove os verbos de pedir foto e pronomes/preposições, e vê o que sobra
  const stripped = t
    .replace(/(foto|fotos|imagem|imagens|figura|figuras)/g, "")
    .replace(/(me manda|me envia|me mostra|envia|manda|mostra|posso ver|tem|pode|poderia|novamente|de novo|outra vez|tambem|também)/g, "")
    .replace(/\b(dela|dele|delas|deles|disso|dessa|desse|dessas|desses|essa|esse|essas|esses|aquela|aquele|aquelas|aqueles|uma|um|umas|uns|de|do|da|dos|das|para|pra|por|com|favor|por favor)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return stripped.length < 3; // sobrou quase nada → é genérico
}

// Junta a mensagem atual com mensagens anteriores do cliente E a última resposta do bot
// para inferir o produto pedido quando o pedido de foto é genérico ("me manda uma foto dela").
function buildPhotoQueryContext(userMsg: string, history: any[]): string {
  if (!isGenericPhotoRequest(userMsg)) return userMsg;
  // Pega as últimas 4 mensagens do CLIENTE (inbound) — provável que mencionem o produto
  const inbounds = history.filter((m: any) => m.direction === "inbound").slice(-4);
  const ctxText = inbounds.map((m: any) => m.content).join(" ");
  // A última resposta do bot é CRÍTICA: costuma citar o nome exato do produto recém-mencionado
  // (ex: "A BLUSA 7196 CAROL TRICO está disponível...") — vale mais que qualquer outra fonte
  const lastBot = [...history].reverse().find((m: any) => m.direction === "outbound");
  const combined = `${lastBot?.content ?? ""} ${ctxText} ${userMsg}`.trim();
  console.log("[photo] generic request → combined query:", combined.slice(0, 200));
  return combined;
}

// Busca variações com foto que correspondam à mensagem (com fallback para o contexto da conversa)
async function findPhotoMatches(
  userMsg: string,
  supplier: string | null,
  history: any[] = [],
): Promise<{ url: string; caption: string }[]> {
  const queryText = buildPhotoQueryContext(userMsg, history);
  const keywords = extractKeywords(queryText);
  console.log("[photo] keywords:", keywords, "supplier:", supplier);

  // 1) Busca por produtos cujo name/description/category/sku case com alguma keyword
  let q = supabase
    .from("products")
    .select("id, name, supplier, product_variants(size, color, image_url, quantity)")
    .eq("active", true)
    .limit(20);
  if (supplier) q = q.eq("supplier", supplier);
  if (keywords.length > 0) {
    q = q.or(keywords.flatMap((k) => [`name.ilike.%${k}%`, `description.ilike.%${k}%`, `category.ilike.%${k}%`, `sku.ilike.%${k}%`]).join(","));
  }
  const { data: byProduct } = await q;

  // 2) Busca também variantes cuja color/size case com keywords (ex.: "marrom", "preto", "P", "M")
  const productsById = new Map<string, any>();
  for (const p of byProduct ?? []) productsById.set((p as any).id, p);

  if (keywords.length > 0) {
    const variantOr = keywords
      .flatMap((k) => [`color.ilike.%${k}%`, `size.ilike.%${k}%`])
      .join(",");
    const { data: variantHits } = await supabase
      .from("product_variants")
      .select("product_id")
      .or(variantOr)
      .not("image_url", "is", null)
      .limit(40);
    const extraIds = Array.from(
      new Set((variantHits ?? []).map((v: any) => v.product_id).filter((id: string) => !productsById.has(id)))
    );
    if (extraIds.length > 0) {
      let q2 = supabase
        .from("products")
        .select("id, name, supplier, product_variants(size, color, image_url, quantity)")
        .eq("active", true)
        .in("id", extraIds);
      if (supplier) q2 = q2.eq("supplier", supplier);
      const { data: extraProducts } = await q2;
      for (const p of extraProducts ?? []) productsById.set((p as any).id, p);
    }
  }

  // 3) Para cada produto, ordena variantes priorizando as que casam com keywords (cor/tamanho)
  const variantMatchesKeyword = (v: any) => {
    if (keywords.length === 0) return false;
    const hay = `${v.color ?? ""} ${v.size ?? ""}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return keywords.some((k) => hay.includes(k));
  };

  const out: { url: string; caption: string }[] = [];
  for (const p of productsById.values()) {
    const variants = ((p as any).product_variants ?? []).filter((v: any) => v.image_url);
    variants.sort((a: any, b: any) => {
      const am = variantMatchesKeyword(a) ? 1 : 0;
      const bm = variantMatchesKeyword(b) ? 1 : 0;
      return bm - am;
    });
    for (const v of variants) {
      const variantLabel = [v.size, v.color].filter(Boolean).join(" / ");
      out.push({ url: v.image_url, caption: `${(p as any).name}${variantLabel ? ` — ${variantLabel}` : ""}` });
      if (out.length >= 4) return out;
    }
  }
  return out;
}

async function getOrCreateConversation(phone: string) {
  const { data: existing } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("customer_phone", phone)
    .maybeSingle();
  if (existing) return existing;

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  const { data: created } = await supabase
    .from("whatsapp_conversations")
    .insert({ customer_phone: phone, customer_id: customer?.id ?? null })
    .select()
    .single();
  return created;
}

// Normaliza para comparação (sem acento, minúsculo, sem espaços extras)
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// === Inferência de gênero pelo primeiro nome (heurística pt-BR) ===
// Retorna "F" | "M" | "U" (desconhecido). Usado para evitar tratar
// homem como "querida" e vice-versa.
const MALE_NAMES = new Set([
  "joao","jose","pedro","paulo","lucas","luis","luiz","marcos","marco","mateus","matheus",
  "gabriel","rafael","daniel","felipe","filipe","fernando","carlos","andre","antonio","alexandre",
  "ricardo","rodrigo","roberto","bruno","thiago","tiago","leonardo","leandro","gustavo","guilherme",
  "diego","douglas","eduardo","edson","emerson","fabio","flavio","henrique","hugo","igor","ivan",
  "jorge","julio","kevin","marcelo","mario","mauricio","murilo","nathan","otavio","raul","renan",
  "renato","samuel","sergio","vinicius","vitor","victor","wagner","wesley","william","willian",
  "yuri","arthur","artur","bernardo","caio","cesar","cristiano","davi","david","enzo","erick","eric",
  "fabricio","francisco","ismael","israel","ivo","jean","jonas","jonathan","kaio","levi","luan",
  "miguel","nicolas","noah","ramon","raphael","reinaldo","rian","ryan","saulo","silas","theo",
  "valter","walter","wallace","washington","welinton","welington","wellington","adriano","alex","alan",
  "allan","amauri","aldo","aluisio","aluizio","arnaldo","benedito","benjamim","cassio","claudio",
  "cleber","clovis","danilo","dario","dener","denis","dennis","derek","dirceu","domingos","edmilson",
  "edmundo","edvaldo","elias","eliel","elizeu","elton","emanuel","ezequiel","fabiano","francinaldo",
  "geraldo","gilberto","gilmar","heitor","heric","ian","ibere","idelfonso","ildefonso","ilan",
  "joaquim","jovani","junior","kauan","kaue","laercio","lazaro","lourival","lucio","luciano",
  "manoel","manuel","mauro","mike","milton","moacir","moises","natanael","nelson","newton","odair",
  "olavo","orlando","osmar","oswaldo","peterson","plinio","reinan","robson","ronald","ronaldo",
  "ruan","rui","salomao","sandro","sebastiao","silvio","tadeu","tales","tarcisio","teo","tomas",
  "ulisses","valdir","valentim","vagner","vando","vladimir","wanderson","weverton","wilson","yago","iago",
]);

const FEMALE_NAMES = new Set([
  "maria","ana","julia","juliana","mariana","camila","carla","carolina","caroline","beatriz","bia",
  "amanda","aline","alice","alessandra","adriana","barbara","bruna","clara","claudia","cristina",
  "daniela","debora","deborah","elaine","eliane","elisa","eliza","eduarda","fatima","fernanda",
  "flavia","francisca","gabriela","giovana","giovanna","gisele","helena","heloisa","isabel","isabela",
  "isabella","isadora","janaina","jaqueline","jessica","joana","josefa","karen","karina","katia",
  "larissa","laura","leticia","livia","luana","lucia","luciana","luisa","luiza","manuela","marcela",
  "marcia","margarida","marina","marta","mayara","melissa","milena","monica","natalia","natasha",
  "nayara","neusa","nicole","olga","paula","patricia","priscila","rafaela","raquel","regina",
  "renata","roberta","rosa","rosana","rosangela","sabrina","sandra","sara","sarah","silvia","simone",
  "sofia","solange","sonia","stephanie","suely","tais","tania","tatiana","tatiane","teresa","thais",
  "valentina","vanessa","vera","veronica","viviane","yara","yasmin","zilda","zoe","alana","aleska",
  "alexia","alicia","aparecida","ariana","ariane","ariadne","aurea","betina","carmem","carmen",
  "cassia","catarina","celeste","celia","cibele","cida","cinthia","cintia","conceicao","cris",
  "dalva","dani","dayane","dayse","denise","diana","diane","divina","doralice","edna","edivania",
  "elen","ellen","elis","elize","elvira","emilia","emily","eunice","eva","evelyn","fabiana",
  "geni","georgia","gilda","glaucia","gloria","graca","graziela","gracinha","ines","ingrid","irene",
  "iris","ivana","ivete","janete","janice","jandira","kamila","karla","keila","kelly","leila",
  "leonor","liana","lidia","liliana","lilian","lina","lourdes","luana","lucineia","luzia","madalena",
  "magali","magda","malu","marisa","marlene","marli","marli","marlucia","matilde","mercedes","michele",
  "michelle","mirela","mirella","miriam","myrian","nadia","nair","nara","nathalia","neide","nilza",
  "noemi","norma","odete","olivia","penha","perla","poliana","pollyana","raissa","raisa","rebeca",
  "rejane","rita","rosane","rute","ruth","scarlet","selma","silvana","sirlei","sirlene","sueli",
  "talita","tamires","tereza","valeria","vania","vilma","vitoria","wanda","wania","wendy","yasmim",
  "yolanda","zelia","zenaide","querida",
]);

// Sufixos que indicam gênero quando o nome não está nas listas
function genderBySuffix(first: string): "F" | "M" | "U" {
  if (first.length < 4) return "U";
  // Femininos: -a, -ana, -ina, -elle, -ene, -ice, -ete, -alia
  if (/(a|ana|ina|elle|ice|ete|alia|inha|ele)$/.test(first)) return "F";
  // Masculinos: -o, -on, -er, -el, -is, -us, -ar, -or, -in, -son, -ton, -ius, -aldo
  if (/(o|on|er|el|is|us|ar|or|in|son|ton|ius|aldo|ano|eu|ulo|aro|ero|iro|oro|uro)$/.test(first)) return "M";
  return "U";
}

function inferGender(fullName: string | null | undefined): "F" | "M" | "U" {
  if (!fullName) return "U";
  const first = norm(fullName).split(/\s+/)[0] ?? "";
  if (!first) return "U";
  if (FEMALE_NAMES.has(first)) return "F";
  if (MALE_NAMES.has(first)) return "M";
  // Compostos comuns: "maria eduarda", "ana clara" → primeiro já bateu acima.
  // Se não bateu, tenta o segundo nome (ex.: "Sr. João" → "joao")
  const second = norm(fullName).split(/\s+/)[1] ?? "";
  if (FEMALE_NAMES.has(second)) return "F";
  if (MALE_NAMES.has(second)) return "M";
  return genderBySuffix(first);
}

// Detecta se o cliente mencionou um fornecedor específico na mensagem
async function detectSupplier(userMsg: string): Promise<string | null> {
  const { data } = await supabase
    .from("products")
    .select("supplier")
    .eq("active", true)
    .not("supplier", "is", null);
  const suppliers = Array.from(
    new Set((data ?? []).map((r: any) => r.supplier).filter((s: any) => !!s && s.trim() !== ""))
  );
  const msg = norm(userMsg);
  for (const s of suppliers) {
    const ns = norm(s);
    if (msg.includes(ns)) return s;
    const tokens = ns.split(/\s+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => msg.includes(t))) return s;
  }
  return null;
}

// Pergunta referencial: cliente se refere a algo SEM citar o nome do produto
// (ex.: "qual o valor dele?", "quanto custa?", "tem em M?", "e a cor?", "tem outro tamanho?")
function isReferentialProductQuestion(text: string): boolean {
  const t = norm(text);
  // Pronomes/refs que indicam "o produto que acabamos de falar"
  const hasReference = /\b(dele|dela|deles|delas|disso|desse|dessa|desses|dessas|esse|essa|esses|essas|aquele|aquela|isso|aquilo)\b/.test(t);
  // Perguntas curtas sobre preço/tamanho/cor sem nome de produto
  const shortAttrQuestion =
    t.length < 60 &&
    /(quanto|valor|preco|preço|custa|sai por|tem em|tem no|tem outro|tem outra|qual.*tamanho|qual.*cor|qual.*medida|tamanho|cor)/.test(t);
  // Sem palavras-chave fortes de produto (substantivos típicos do catálogo)
  const hasProductNoun = /\b(blusa|vestido|calca|calça|saia|short|colete|conjunto|chemissie|camisa|camiseta|macacao|macacão|body|jaqueta|cardigan|legging|regata|tricot|tricô|trico|sapato|sandalia|sandália|tenis|tênis|bolsa|cinto|brinco|colar)\b/.test(t);
  return (hasReference || shortAttrQuestion) && !hasProductNoun;
}

// Constrói uma query enriquecida com o produto recém-mencionado pelo bot,
// quando a pergunta atual do cliente é referencial ("qual o valor dele?").
function buildProductSearchQuery(userMsg: string, history: any[]): string {
  if (!isReferentialProductQuestion(userMsg)) return userMsg;
  const lastBot = [...history].reverse().find((m: any) => m.direction === "outbound");
  // Pega também a penúltima inbound do cliente, que é onde ele costuma ter dito o nome do produto
  const lastInbound = [...history].reverse().find((m: any) => m.direction === "inbound");
  const combined = `${lastBot?.content ?? ""} ${lastInbound?.content ?? ""} ${userMsg}`.trim();
  console.log("[search] referential question → combined query:", combined.slice(0, 200));
  return combined;
}

// RAG: busca produtos relevantes à mensagem do cliente, opcionalmente restrito a um fornecedor
async function searchProducts(userMsg: string, supplier: string | null, history: any[] = []) {
  const queryText = buildProductSearchQuery(userMsg, history);
  const keywords = extractKeywords(queryText);
  let matched: any[] = [];

  if (keywords.length > 0) {
    const orFilter = keywords
      .flatMap((k) => [
        `name.ilike.%${k}%`,
        `description.ilike.%${k}%`,
        `category.ilike.%${k}%`,
        `sku.ilike.%${k}%`,
      ])
      .join(",");

    let q = supabase
      .from("products")
      .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
      .eq("active", true)
      .or(orFilter)
      .limit(20);
    if (supplier) q = q.eq("supplier", supplier);
    const { data } = await q;
    matched = data ?? [];
  }

  // Catálogo geral — restringe ao fornecedor se mencionado
  let gq = supabase
    .from("products")
    .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
    .eq("active", true)
    .limit(supplier ? 50 : 20);
  if (supplier) gq = gq.eq("supplier", supplier);
  const { data: general } = await gq;

  const seen = new Set<string>();
  const all = [...matched, ...(general ?? [])].filter((p: any) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  return { matched, all };
}

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "-";
  // iso: "2026-04-10" -> "10/04/2026"
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Heurísticas para extrair dados de cadastro da mensagem do cliente
function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

function looksLikeAddress(text: string): boolean {
  // Tem número + alguma palavra típica de endereço, ou CEP
  const t = text.toLowerCase();
  if (/\d{5}-?\d{3}/.test(t)) return true; // CEP
  const hasNumber = /\d/.test(t);
  const hasKeyword = /(rua|av\.?|avenida|travessa|alameda|estrada|rodovia|bairro|quadra|n[º°ºo]|cep|cidade)/i.test(t);
  return hasNumber && hasKeyword && t.length >= 15;
}

function looksLikeName(text: string): boolean {
  // 2+ palavras alfabéticas, sem dígitos, sem @, curto
  const t = text.trim();
  if (t.length > 80 || t.length < 3) return false;
  if (/[@\d]/.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ'`-]{2,}$/.test(w));
  return words.length >= 1 && words.length <= 6;
}

function missingFields(c: any | null): string[] {
  const miss: string[] = [];
  // Considera nome ausente se: vazio, igual ao telefone, ou só dígitos
  const nameStr = (c?.name ?? "").trim();
  const looksLikePhone = /^\+?\d[\d\s().-]*$/.test(nameStr);
  if (!nameStr || nameStr === c?.phone || looksLikePhone) miss.push("nome");
  if (!c?.address || c.address.trim() === "") miss.push("endereço");
  if (!c?.email || c.email.trim() === "") miss.push("email");
  return miss;
}

// Tenta auto-cadastrar a partir do texto + último campo solicitado (do histórico)
async function autoUpdateCustomer(phone: string, customer: any | null, userMsg: string, lastAskedField: string | null) {
  const updates: any = {};
  const text = userMsg.trim();

  const email = extractEmail(text);
  if (email && (!customer?.email || customer.email.trim() === "")) {
    updates.email = email;
  }

  const nameMissing = !customer?.name || customer.name === customer.phone || /^\+?\d[\d\s().-]*$/.test((customer?.name ?? "").trim());

  // Só infere nome quando a IA acabou de pedir o nome — nunca da primeira mensagem espontânea
  if (lastAskedField === "nome" && nameMissing) {
    if (looksLikeName(text)) updates.name = text;
  } else if (lastAskedField === "endereço" && (!customer?.address || customer.address.trim() === "")) {
    if (text.length >= 10) updates.address = text;
  } else {
    // Heurística geral — só endereço (nunca nome) sem ter sido pedido
    if ((!customer?.address || customer.address.trim() === "") && looksLikeAddress(text)) {
      updates.address = text;
    }
  }

  if (Object.keys(updates).length === 0) return customer;

  if (customer) {
    const { data } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", customer.id)
      .select("id, name, phone, address, email")
      .maybeSingle();
    return data ?? customer;
  } else {
    // IMPORTANTE: nunca usar telefone como nome. Se não temos nome real ainda, deixa null
    // (a coluna name é NOT NULL no schema — então usamos placeholder vazio "?" para forçar a IA a perguntar).
    const { data } = await supabase
      .from("customers")
      .insert({
        phone,
        name: updates.name ?? "(sem nome)",
        address: updates.address ?? null,
        email: updates.email ?? null,
      })
      .select("id, name, phone, address, email")
      .maybeSingle();
    if (data) {
      await supabase.from("whatsapp_conversations").update({ customer_id: data.id }).eq("customer_phone", phone);
    }
    return data;
  }
}

// Detecta qual campo a IA pediu na última mensagem outbound
function detectLastAskedField(history: any[]): string | null {
  const lastBot = [...history].reverse().find((m) => m.direction === "outbound");
  if (!lastBot) return null;
  const c = lastBot.content.toLowerCase();
  if (/(qual.*(seu|teu).*nome|me diz.*nome|qual.*nome.*querida)/.test(c)) return "nome";
  if (/(endere[çc]o|rua|cep|bairro)/.test(c)) return "endereço";
  if (/(e-?mail)/.test(c)) return "email";
  return null;
}

// ============================================================
// REGRA 1 — FOCO DE PRODUTO (PRIORIDADE: ÚLTIMA MÍDIA > TEXTO)
// ============================================================
// Detecta se a última outbound foi uma IMAGEM de produto. Se sim,
// ela ganha contra qualquer menção textual anterior. Quando há mais
// de uma imagem de produtos diferentes recentes, marca ambiguidade.
async function detectFocusedProduct(
  history: any[]
): Promise<{ product: any | null; source: "media" | "text" | "none"; ambiguous: boolean; mediaCaption?: string }> {
  const outbounds = history.filter((m: any) => m.direction === "outbound");
  if (outbounds.length === 0) return { product: null, source: "none", ambiguous: false };

  // Última outbound em ordem cronológica
  const last = outbounds[outbounds.length - 1];
  const lastImageIdx = (() => {
    for (let i = outbounds.length - 1; i >= 0; i--) {
      if (outbounds[i].media_type === "image") return i;
    }
    return -1;
  })();

  // Última menção textual a produto (outbound TEXTO, sem media_type)
  const lastTextIdx = (() => {
    for (let i = outbounds.length - 1; i >= 0; i--) {
      if (!outbounds[i].media_type && outbounds[i].content) return i;
    }
    return -1;
  })();

  // Decide a fonte: se a imagem é mais recente (>=) que o texto, a imagem ganha
  let useMedia = false;
  let candidateContent = "";
  let source: "media" | "text" | "none" = "none";

  if (lastImageIdx >= 0 && lastImageIdx >= lastTextIdx) {
    useMedia = true;
    candidateContent = outbounds[lastImageIdx].content ?? "";
    source = "media";
  } else if (lastTextIdx >= 0) {
    candidateContent = outbounds[lastTextIdx].content ?? "";
    source = "text";
  } else if (last?.content) {
    candidateContent = last.content;
    source = "text";
  } else {
    return { product: null, source: "none", ambiguous: false };
  }

  // Detecta ambiguidade: 2 imagens recentes (últimas 4 outbound) com legendas distintas
  const recentImages = outbounds.slice(-4).filter((m: any) => m.media_type === "image" && m.content);
  const distinctCaptions = new Set(recentImages.map((m: any) => norm(m.content).slice(0, 30)));
  const ambiguous = useMedia && distinctCaptions.size >= 2;

  const keywords = extractKeywords(candidateContent);
  if (keywords.length === 0) return { product: null, source, ambiguous, mediaCaption: useMedia ? candidateContent : undefined };

  const orFilter = keywords
    .flatMap((k) => [`name.ilike.%${k}%`, `sku.ilike.%${k}%`])
    .join(",");
  const { data } = await supabase
    .from("products")
    .select("name, price, category, description, sku, supplier, product_variants(size, color, quantity)")
    .eq("active", true)
    .or(orFilter)
    .limit(5);
  if (!data || data.length === 0) return { product: null, source, ambiguous, mediaCaption: useMedia ? candidateContent : undefined };

  const refText = norm(candidateContent);
  let best: any = null;
  let bestScore = 0;
  for (const p of data) {
    const tokens = norm(p.name).split(/\s+/).filter((t: string) => t.length >= 3);
    const score = tokens.filter((t: string) => refText.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  // Imagem é mais confiável: aceita score >= 1; texto exige >= 2
  const minScore = useMedia ? 1 : 2;
  return {
    product: bestScore >= minScore ? best : null,
    source,
    ambiguous,
    mediaCaption: useMedia ? candidateContent : undefined,
  };
}

// ============================================================
// REGRA 2 — SAUDAÇÃO RELIGIOSA / MENSAGEM AMBÍGUA
// ============================================================
function isReligiousGreeting(text: string): boolean {
  const t = norm(text);
  return /\b(paz\s*d?e?\s*deus|apddeus|ap\s*d\s*deus|amem|gloria\s*a?\s*deus|deus\s*te?\s*aben[çc]oe|deus\s*aben[çc]oe|paz\s*do\s*senhor|jesus\s*te?\s*ama)\b/.test(t);
}

function isUnclearMessage(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // Muito curto e sem palavra real (ex: "?", "...", "kk")
  if (t.length < 4 && !/[a-zà-ÿ]{2,}/i.test(t)) return true;
  return false;
}

// ============================================================
// REGRA 3 — SANITIZADOR DE EMOJIS POR GÊNERO (PÓS-PROCESSAMENTO)
// ============================================================
const FEMININE_EMOJIS = /[\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F499}\u{1F49A}\u{1F49B}\u{1F49C}\u{1F49D}\u{1F49E}\u{1F49F}\u{1F970}\u{1F338}\u{1F339}\u{1F33A}\u{1F33B}\u{1F337}\u2763\uFE0F]/gu;
// 💕 💖 💗 💘 💙 💚 💛 💜 💝 💞 💟 🥰 🌸 🌹 🌺 🌻 🌷 ❣️
const FEMININE_VOCATIVES_RE = /\b(querida|queridinha|linda|lindinha|gata|gatinha|flor|florzinha|amada|fofa|fofinha|amor|amorzinho|princesa|amiga|amigona)\b/gi;

function sanitizeReplyByGender(text: string, gender: "F" | "M" | "U"): string {
  if (gender === "F") return text;
  let out = text;
  // Remove emojis afetivos
  out = out.replace(FEMININE_EMOJIS, "");
  // Substitui vocativos femininos
  if (gender === "M") {
    out = out.replace(FEMININE_VOCATIVES_RE, "amigo");
  } else {
    out = out.replace(FEMININE_VOCATIVES_RE, "");
  }
  // Limpa espaços duplicados, espaço antes de pontuação e linhas em branco residuais
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?:;])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

async function buildContext(phone: string, userMsg: string, history: any[]) {
  const supplierMentioned = await detectSupplier(userMsg);
  const { matched, all } = await searchProducts(userMsg, supplierMentioned, history);
  const focusedResult = await detectFocusedProduct(history);

  const { data: rawCustomer } = await supabase
    .from("customers")
    .select("id, name, nickname, address, email")
    .eq("phone", phone)
    .maybeSingle();

  const lastAsked = detectLastAskedField(history);
  const customer = await autoUpdateCustomer(phone, rawCustomer, userMsg, lastAsked);

  let debts: any[] = [];
  if (customer) {
    const { data } = await supabase
      .from("accounts_receivable")
      .select("description, amount, due_date, status")
      .eq("customer_id", customer.id)
      .neq("status", "pago");
    debts = (data ?? []).map((d: any) => ({ ...d, due_date: formatDateBR(d.due_date) }));
  }

  const missing = missingFields(customer);

  return {
    matched,
    all,
    customer,
    debts,
    missing,
    supplierMentioned,
    focused: focusedResult.product,
    focusedSource: focusedResult.source,
    focusedAmbiguous: focusedResult.ambiguous,
    focusedMediaCaption: focusedResult.mediaCaption ?? null,
  };
}

function formatProducts(list: any[]) {
  if (list.length === 0) return "(nenhum)";
  return list
    .map((p: any) => {
      const vars = (p.product_variants ?? [])
        .map((v: any) => `${v.size ?? "-"}/${v.color ?? "-"} (estoque: ${v.quantity})`)
        .join("; ");
      return `• ${p.name} (SKU ${p.sku ?? "-"}) — R$ ${p.price} — ${p.category ?? ""} — Fornecedor: ${p.supplier ?? "-"} — Variações: ${vars || "única"}`;
    })
    .join("\n");
}

async function callAI(systemPrompt: string, history: any[], userMsg: string, ctx: any, isFirstMessage: boolean, pix: { key?: string | null; type?: string | null; recipient?: string | null }) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");

  const matchInfo =
    ctx.matched.length > 0
      ? `Produtos que correspondem à pergunta do cliente:\n${formatProducts(ctx.matched)}`
      : `⚠️ Nenhum produto do catálogo corresponde à pergunta atual do cliente. Se ele pediu um modelo específico (ex: "vestido amanda"), diga que NÃO temos esse modelo e ofereça alternativas reais da lista geral abaixo.`;

  const focusedBlock = ctx.focused
    ? `O ÚLTIMO produto que VOCÊ (assistente) acabou de mostrar/citar para o cliente foi:
${formatProducts([ctx.focused])}

→ REGRA CRÍTICA: se a mensagem atual do cliente for referencial (ex.: "qual o valor dele?", "quanto custa?", "tem em M?", "qual a cor?", "quero esse"), ela se refere SEMPRE a este produto acima — NUNCA a outros produtos antigos do histórico. Use o nome, preço e variações DESTE produto.`
    : `→ Nenhum produto específico em foco no momento. Se o cliente fizer pergunta referencial sem citar produto, peça pra ele confirmar qual modelo é.`;

  const supplierBlock = ctx.supplierMentioned
    ? `→ O cliente mencionou o FORNECEDOR "${ctx.supplierMentioned}". Mostre APENAS produtos deste fornecedor (a lista abaixo já está filtrada). Se ele pedir algo de outro fornecedor depois, troque o filtro.`
    : `→ Nenhum fornecedor específico mencionado. Use o catálogo geral.`;

  const pixBlock = pix.key
    ? `Chave PIX configurada: ${pix.key}
Tipo: ${pix.type ?? "não informado"}${pix.recipient ? `\nRecebedor: ${pix.recipient}` : ""}

→ Quando a cliente confirmar interesse em fechar/pagar, envie a chave PIX de forma CURTA E DIRETA, SEM enrolação. NÃO repita a chave 2x, NÃO escreva parágrafo longo, NÃO peça pra ela "verificar dados", NÃO ofereça outras formas de pagamento.

FORMATO OBRIGATÓRIO da mensagem com PIX (use exatamente este modelo, adaptando só o emoji conforme o gênero):
"PIX (${pix.type ?? "chave"}): ${pix.key}${pix.recipient ? `\nRecebedor: ${pix.recipient}` : ""}
Me manda o comprovante quando pagar 💕"

→ NÃO invente outras chaves PIX, contas bancárias ou formas de pagamento.`
    : `→ Nenhuma chave PIX configurada. Se a cliente perguntar sobre pagamento, diga que vai verificar com a equipe e retorna em breve.`;

  const customerGender = inferGender(ctx.customer?.name);
  const genderBlock =
    customerGender === "F"
      ? "→ Cliente é MULHER. Use tratamento feminino: querida, linda, amiga, obrigada. NUNCA use 'querido', 'amigo', 'lindo'."
      : customerGender === "M"
      ? "→ Cliente é HOMEM. Use tratamento masculino e NEUTRO: amigo, parceiro, chefe, beleza. NUNCA use 'querida', 'linda', 'amiga', 'gata', 'flor', emojis 💕🥰💖. Tom mais direto, sem diminutivos afetivos. Pode usar 👍✅."
      : "→ Gênero do cliente DESCONHECIDO. Use tratamento NEUTRO: 'oi', 'tudo bem?', 'obrigado(a)'. NÃO use 'querida' nem 'querido' até descobrir o gênero pelo nome.";

  const contextText = `
=== ESTADO DA CONVERSA ===
PRIMEIRA_MENSAGEM=${isFirstMessage ? "true" : "false"}
${isFirstMessage
  ? "→ Esta é a PRIMEIRA mensagem desta conversa. Cumprimente e se apresente UMA vez."
  : "→ Conversa JÁ EM ANDAMENTO. NÃO se apresente, NÃO diga seu nome, NÃO diga 'aqui é da JMK'. Vá direto ao ponto."}

=== TRATAMENTO POR GÊNERO (CRÍTICO) ===
${genderBlock}

=== FOTOS ===
Se a cliente pediu foto/imagem ("me manda foto", "tem foto?"), o sistema JÁ ENVIOU as imagens disponíveis automaticamente em mensagens separadas ANTES desta sua resposta. Apenas comente brevemente ("Mandei aqui ó", "Olha que lindos") — NÃO descreva foto que não existe e NÃO prometa enviar foto. Se não houver foto cadastrada para o item pedido, avise gentilmente que vai verificar com a equipe.

=== FILTRO POR FORNECEDOR ===
${supplierBlock}

=== CATÁLOGO ${ctx.supplierMentioned ? `(filtrado por fornecedor "${ctx.supplierMentioned}")` : "COMPLETO"} — use SOMENTE estes produtos ===
${formatProducts(ctx.all)}

=== PRODUTO EM FOCO (último mostrado por VOCÊ) ===
${focusedBlock}

=== BUSCA NA PERGUNTA ATUAL ===
${matchInfo}

=== CLIENTE ===
${ctx.customer
  ? `Nome: ${ctx.customer.name ?? "(faltando)"} | Endereço: ${ctx.customer.address ?? "(faltando)"} | E-mail: ${ctx.customer.email ?? "(faltando)"} | Gênero detectado: ${customerGender === "F" ? "Feminino" : customerGender === "M" ? "Masculino" : "Desconhecido"}`
  : "Cliente NÃO cadastrado."}
CAMPOS FALTANDO: ${ctx.missing.length === 0 ? "nenhum (cadastro completo — NÃO pergunte dados pessoais)" : ctx.missing.join(", ") + " — peça APENAS UM por mensagem, na ordem: nome → endereço → email. NÃO fale de produtos enquanto faltar dados."}

=== DÍVIDAS PENDENTES (FONTE DA VERDADE — ignore datas/valores do histórico) ===
${ctx.debts.length === 0 ? "Nenhuma" : ctx.debts.map((d: any) =>
  `• ${d.description ?? "Compra"} — R$ ${d.amount} — vence ${d.due_date} — status ${d.status}`
).join("\n")}

=== PAGAMENTO (PIX) ===
${pixBlock}
`.trim();

  const SALES_FOCUS = `
=== MISSÃO (NÃO NEGOCIÁVEL) ===
Você é vendedora. Seu único objetivo é FECHAR A VENDA. Toda mensagem deve mover a cliente para a próxima etapa do funil:
  CADASTRO (nome → endereço → email)  →  PRODUTO (o que quer, tamanho, cor)  →  FECHAMENTO ("posso te passar o PIX?")  →  PIX (chave + pedir comprovante)

REGRAS DE FUNIL:
1. Se faltam dados de cadastro: peça UM por vez, NÃO fale de produto ainda.
2. Cadastro completo + cliente perguntou de produto: mostre opções reais e pergunte tamanho/cor.
3. Cliente demonstrou interesse num produto (preço, "quero", "vou levar", "tem em M?"): pule para fechamento — pergunte "Posso te passar o PIX pra fechar?"
4. Cliente confirmou pagamento: envie a chave PIX no formato CURTO e peça o comprovante.
5. Cliente mandou comprovante: agradeça e confirme que vai separar/enviar o pedido.

ESTILO:
- 1 a 3 frases por mensagem. WhatsApp é conversa, não e-mail.
- Direto ao ponto, SEM enrolação, SEM "posso ajudar em algo mais?", SEM textão.
- Sempre termine direcionando: pergunte tamanho, ofereça o PIX, peça o comprovante.
- Use SOMENTE produtos e PIX do contexto abaixo. NUNCA invente.
`.trim();

  const messages = [
    { role: "system", content: SALES_FOCUS + "\n\n" + systemPrompt + "\n\n" + contextText },
    ...history.slice(-10).map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content,
    })),
    { role: "user", content: userMsg },
  ];

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
  });

  if (!resp.ok) {
    console.error("AI error", resp.status, await resp.text());
    return "Desculpe, estou com uma instabilidade no momento. Pode tentar novamente em instantes? 💕";
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "Desculpe, não entendi. Pode reformular?";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const cfg = await loadConfig();
    if (mode === "subscribe" && token && cfg?.verify_token && token === cfg.verify_token) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  try {
    const body = await req.json();
    const cfg = await loadConfig();
    const ai = await loadAISettings();

    if (!cfg?.enabled || !cfg.access_token || !cfg.phone_number_id) {
      console.log("WhatsApp desabilitado ou sem config");
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return new Response("ok", { status: 200, headers: corsHeaders });

    const fromPhone: string = message.from;
    let text: string = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? message.video?.caption ?? "";

    // === MÍDIA RECEBIDA (image, audio, voice, document, video, sticker) ===
    let inboundMedia: {
      kind: "image" | "audio" | "document" | "video" | "sticker";
      mediaId: string;
      filename?: string;
    } | null = null;

    if (message.type === "audio" || message.type === "voice") {
      const mediaId = message.audio?.id ?? message.voice?.id;
      if (mediaId) inboundMedia = { kind: "audio", mediaId };
    } else if (message.type === "image") {
      const mediaId = message.image?.id;
      if (mediaId) inboundMedia = { kind: "image", mediaId };
    } else if (message.type === "document") {
      const mediaId = message.document?.id;
      if (mediaId) inboundMedia = { kind: "document", mediaId, filename: message.document?.filename };
    } else if (message.type === "video") {
      const mediaId = message.video?.id;
      if (mediaId) inboundMedia = { kind: "video", mediaId };
    } else if (message.type === "sticker") {
      const mediaId = message.sticker?.id;
      if (mediaId) inboundMedia = { kind: "sticker", mediaId };
    }

    let savedMediaPath: string | null = null;
    let savedMediaMime: string | null = null;
    let savedMediaName: string | null = null;
    let audioFailureNote: string | null = null;

    if (inboundMedia) {
      const media = await downloadWhatsAppMedia(inboundMedia.mediaId, cfg);
      if (media) {
        savedMediaPath = await saveInboundMedia(media.bytes, media.mimeType, fromPhone, inboundMedia.filename);
        savedMediaMime = media.mimeType;
        savedMediaName = inboundMedia.filename ?? null;

        // Áudio: também transcreve para alimentar a IA
        if (inboundMedia.kind === "audio" && !text) {
          const transcript = await transcribeAudio(media.base64, media.mimeType);
          if (transcript) {
            text = transcript;
            console.log("Áudio transcrito:", text);
          } else if (!savedMediaPath) {
            audioFailureNote = "[🎤 Áudio recebido — falha ao transcrever]";
          }
        }
      } else if (inboundMedia.kind === "audio") {
        audioFailureNote = "[🎤 Áudio recebido — falha ao baixar da Meta (token pode ter expirado)]";
      }
    }

    // Se houve falha de áudio sem nada salvo nem texto, registra e avisa
    if (audioFailureNote && !text && !savedMediaPath) {
      const conv = await getOrCreateConversation(fromPhone);
      if (conv) {
        await supabase.from("whatsapp_messages").insert({
          conversation_id: conv.id,
          direction: "inbound",
          content: audioFailureNote,
        });
        await supabase
          .from("whatsapp_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conv.id);
      }
      await sendWhatsApp(
        fromPhone,
        "Desculpe, não consegui ouvir seu áudio 😅 Pode escrever a mensagem ou gravar novamente, por favor? 💕",
        cfg
      );
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Sem texto e sem mídia salva → ignora
    if (!text && !savedMediaPath) return new Response("ok", { status: 200, headers: corsHeaders });

    const conv = await getOrCreateConversation(fromPhone);
    if (!conv) {
      console.error("Falha ao criar/obter conversa para", fromPhone);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // Inserção da mensagem inbound (com mídia se houver)
    const labelByKind: Record<string, string> = {
      image: "[📷 Imagem]",
      audio: "[🎤 Áudio]",
      document: "[📎 Documento]",
      video: "[🎥 Vídeo]",
      sticker: "[🌟 Figurinha]",
    };
    const inboundContent = text?.trim() ? text : (inboundMedia ? labelByKind[inboundMedia.kind] : "");

    const { error: insErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "inbound",
      content: inboundContent,
      media_path: savedMediaPath,
      media_type: inboundMedia?.kind ?? null,
      media_mime: savedMediaMime,
      media_filename: savedMediaName,
    });
    if (insErr) console.error("insert inbound error:", insErr);

    // Se não temos texto nenhum (foto sem caption por ex.), não chama a IA — só registra
    if (!text) {
      await supabase
        .from("whatsapp_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conv.id);
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(20);

    // Primeira mensagem = só existe a inbound que acabamos de inserir agora
    const isFirstMessage = (history?.length ?? 0) <= 1;

    const ctx = await buildContext(fromPhone, text, history ?? []);
    const reply = await callAI(
      ai?.system_prompt ?? "",
      history ?? [],
      text,
      ctx,
      isFirstMessage,
      { key: ai?.pix_key, type: ai?.pix_key_type, recipient: ai?.pix_recipient_name }
    );

    // Se a cliente pediu foto, envia imagens antes da resposta de texto.
    // As fotos são gravadas como mensagens próprias (com media_path) pelo
    // sendWhatsAppImage → registerOutboundMedia, então NÃO precisamos
    // adicionar texto extra ("[N foto(s) enviada(s): ...]") na mensagem
    // de resposta — isso só polui o painel.
    let photoFailed = false;
    if (asksForPhoto(text)) {
      const photos = await findPhotoMatches(text, ctx.supplierMentioned, history ?? []);
      const sent: { caption: string }[] = [];
      const failed: { caption: string }[] = [];
      for (const ph of photos) {
        const ok = await sendWhatsAppImage(fromPhone, ph.url, ph.caption, cfg, conv.id);
        if (ok) sent.push(ph); else failed.push(ph);
      }
      if (sent.length > 0) {
        console.log(`[webhook] ${sent.length} foto(s) enviada(s):`, sent.map((p) => p.caption).join(", "));
      }
      if (failed.length > 0) {
        console.warn(`[webhook] ${failed.length} foto(s) falharam:`, failed.map((p) => p.caption).join(", "));
      }
      if (photos.length > 0 && sent.length === 0) {
        photoFailed = true;
      }
    }

    let finalReply = reply;
    if (photoFailed) {
      finalReply = `Ah, desculpa! Tentei te mandar as fotos mas não consegui enviar agora 😅 Mas posso te descrever:\n\n${reply}`;
    }
    await sendWhatsApp(fromPhone, finalReply, cfg);
    const { error: outErr } = await supabase.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      content: finalReply,
    });
    if (outErr) console.error("insert outbound error:", outErr);
    await supabase
      .from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("webhook error", e);
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
