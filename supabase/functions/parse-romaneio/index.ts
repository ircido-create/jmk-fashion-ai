// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai dados de romaneios/notas de fornecedor brasileiros (PDFs).

REGRAS:
1. Identifique o FORNECEDOR (razão social no cabeçalho).
2. Identifique a CONDIÇÃO DE PAGAMENTO: à vista (1 parcela na data de emissão) ou parcelado (busque tabela com vencimentos).
3. Para CADA LINHA de produto extraia:
   - sku: código base do produto (ex.: "05705" mesmo se aparecer "05705.008")
   - name: nome do produto
   - color: cor (texto)
   - size: tamanho (P/M/G/GG/PP/UN ou numérico 36/38/40...)
   - quantity: quantidade
   - cost: preço unitário (custo) em reais (use ponto decimal)
4. Se uma linha tiver grade com múltiplos tamanhos numéricos (38, 40, 42...) e quantidades por coluna, gere UM item por tamanho com quantidade > 0.
5. Ignore totalizadores, cabeçalhos, observações e políticas.
6. NUNCA invente dados. Se algo não estiver claro, omita.

Retorne via tool call.`;

const tool = {
  type: "function",
  function: {
    name: "extract_romaneio",
    description: "Estrutura de dados extraída do romaneio",
    parameters: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Razão social do fornecedor" },
        total: { type: "number", description: "Valor total do romaneio em reais" },
        installments: {
          type: "array",
          description: "Parcelas. Se à vista, retornar uma única parcela com data de emissão.",
          items: {
            type: "object",
            properties: {
              due_date: { type: "string", description: "Data ISO YYYY-MM-DD" },
              amount: { type: "number" },
            },
            required: ["due_date", "amount"],
          },
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              name: { type: "string" },
              color: { type: "string" },
              size: { type: "string" },
              quantity: { type: "number" },
              cost: { type: "number" },
            },
            required: ["sku", "name", "color", "size", "quantity", "cost"],
          },
        },
      },
      required: ["supplier", "total", "installments", "items"],
    },
  },
};

const ceilToInt = (n: number) => Math.ceil(n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return json({ error: "missing auth" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return json({ error: "unauthorized" }, 401);

    const { storage_path, file_hash, filename } = await req.json();
    if (!storage_path || typeof storage_path !== "string") {
      return json({ error: "storage_path required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Duplicidade por hash
    if (file_hash) {
      const { data: dupHash } = await admin
        .from("imported_romaneios")
        .select("id, supplier, total, items_count, filename, created_at")
        .eq("file_hash", file_hash)
        .maybeSingle();
      if (dupHash) {
        return json({ ok: true, skipped: true, reason: "hash", existing: dupHash });
      }
    }

    // Baixar PDF do storage
    const { data: fileData, error: dlErr } = await admin.storage
      .from("romaneios")
      .download(storage_path);
    if (dlErr || !fileData) return json({ error: `download failed: ${dlErr?.message}` }, 400);

    const buf = await fileData.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    const b64 = btoa(binary);

    // Chamar Lovable AI com o PDF. Tenta várias combinações (modelo + prompt reforçado)
    // até obter itens. Gemini às vezes devolve items:[] em PDFs com layout de grade.
    const callAI = async (model: string, reinforce: boolean) => {
      const userText = reinforce
        ? "Este romaneio CONTÉM produtos. Extraia TODAS as linhas da tabela de itens, mesmo em grade de tamanhos (uma linha por combinação SKU+tamanho+cor com quantidade > 0). Nunca devolva items vazio se houver tabela de produtos."
        : "Extraia os dados deste romaneio.";
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "file", file: { filename: "romaneio.pdf", file_data: `data:application/pdf;base64,${b64}` } },
              ],
            },
          ],
          tools: [tool],
          tool_choice: { type: "function", function: { name: "extract_romaneio" } },
        }),
        // Evita que uma única chamada consuma o timeout de 150s da edge function
        signal: AbortSignal.timeout(120_000),
      });
      return resp;
    };

    // Ordem: flash primeiro (rápido) e pro como fallback com prompt reforçado.
    // Mantemos no máximo 2 tentativas para caber no limite de 150s.
    const attempts: Array<{ model: string; reinforce: boolean }> = [
      { model: "google/gemini-2.5-flash", reinforce: true },
      { model: "google/gemini-2.5-pro", reinforce: true },
    ];

    let extracted: any = null;
    let attemptsUsed = 0;
    let lastErr = "";
    for (const a of attempts) {
      attemptsUsed++;
      let aiResp: Response;
      try {
        aiResp = await callAI(a.model, a.reinforce);
      } catch (e) {
        lastErr = "fetch: " + ((e as Error).name === "TimeoutError" ? "timeout 55s" : (e as Error).message);
        console.error("AI gateway fetch failed", lastErr);
        continue;
      }
      if (!aiResp.ok) {
        const errText = await aiResp.text();
        lastErr = errText.slice(0, 200);
        console.error("AI gateway error", aiResp.status, errText.slice(0, 200));
        if (aiResp.status === 429) return json({ error: "Rate limit. Tente novamente em alguns segundos." }, 429);
        if (aiResp.status === 402) return json({ error: "Créditos esgotados. Adicione fundos em Lovable AI." }, 402);
        continue;
      }
      const aiJson = await aiResp.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) { lastErr = "no tool call"; continue; }
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        console.log(`Extracted (attempt ${attemptsUsed}, ${a.model}${a.reinforce ? "+reinforce" : ""}):`, JSON.stringify(parsed).slice(0, 500));
        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          extracted = parsed;
          break;
        }
        // guarda como fallback caso todas as tentativas venham vazias
        if (!extracted) extracted = parsed;
      } catch (e) { lastErr = "json parse: " + (e as Error).message; }
    }

    if (!extracted) {
      return json({ error: "IA não conseguiu extrair os dados: " + lastErr }, 422);
    }

    const { supplier, total, installments, items } = extracted;
    if (!Array.isArray(items) || items.length === 0) {
      return json({
        ok: true,
        skipped: true,
        reason: "no_items",
        attempts: attemptsUsed,
        existing: { supplier, total, filename: filename || null },
      });
    }


    // Duplicidade agora é feita SOMENTE por file_hash (SHA-256) — a checagem por
    // fornecedor+total+itens_count gerava falsos positivos em romaneios pequenos
    // do mesmo fornecedor com valores repetidos.


    let productsCreated = 0;
    let variantsAdded = 0;
    let variantsUpdated = 0;

    // Inserir produtos + variantes
    for (const it of items) {
      const sku = String(it.sku).trim();
      const cost = Number(it.cost);
      const price = ceilToInt(cost * 2);

      // Buscar produto existente
      const { data: existing } = await admin
        .from("products")
        .select("id")
        .eq("sku", sku)
        .maybeSingle();

      let productId: string;
      if (existing) {
        productId = existing.id;
        // Atualiza fornecedor caso ainda não esteja preenchido
        await admin.from("products").update({ supplier }).eq("id", productId).is("supplier", null);
      } else {
        const { data: newP, error: pErr } = await admin
          .from("products")
          .insert({
            sku,
            name: it.name,
            cost,
            price,
            supplier,
            low_stock_threshold: 5,
          })
          .select("id")
          .single();
        if (pErr) {
          console.error("product insert err", pErr);
          continue;
        }
        productId = newP.id;
        productsCreated++;
      }

      // Buscar variante existente
      const { data: existVar } = await admin
        .from("product_variants")
        .select("id, quantity")
        .eq("product_id", productId)
        .eq("size", it.size)
        .eq("color", it.color)
        .maybeSingle();

      if (existVar) {
        await admin
          .from("product_variants")
          .update({ quantity: existVar.quantity + Number(it.quantity) })
          .eq("id", existVar.id);
        variantsUpdated++;
      } else {
        const { error: vErr } = await admin.from("product_variants").insert({
          product_id: productId,
          size: it.size,
          color: it.color,
          quantity: Number(it.quantity),
        });
        if (vErr) console.error("variant insert err", vErr);
        else variantsAdded++;
      }
    }

    // Inserir contas a pagar
    let payableCreated = 0;
    if (Array.isArray(installments) && installments.length > 0) {
      const n = installments.length;
      const rows = installments.map((p, i) => ({
        supplier,
        description: `Romaneio ${n > 1 ? `parcela ${i + 1}/${n}` : "à vista"}`,
        category: "Mercadoria",
        amount: Number(p.amount),
        due_date: p.due_date,
        status: "pendente" as const,
      }));
      const { error: payErr } = await admin.from("accounts_payable").insert(rows);
      if (payErr) console.error("payable insert err", payErr);
      else payableCreated = rows.length;
    }

    // Registrar romaneio importado
    await admin.from("imported_romaneios").insert({
      file_hash: file_hash || null,
      supplier,
      total,
      items_count: items.length,
      storage_path,
      filename: filename || null,
    });

    return json({
      ok: true,
      supplier,
      total,
      products_created: productsCreated,
      variants_added: variantsAdded,
      variants_updated: variantsUpdated,
      payable_created: payableCreated,
      items_count: items.length,
    });
  } catch (e) {
    console.error("parse-romaneio error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
