// @ts-nocheck
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM_PROMPT = `Você extrai lançamentos de contas a receber de extratos/relatórios bancários ou comerciais brasileiros (PDFs).

REGRAS CRÍTICAS:
1. Identifique CADA LANÇAMENTO/PARCELA pendente ou em aberto. NÃO PULE NENHUMA LINHA.
2. Processe o PDF INTEIRO - todas as páginas, do início ao fim.
3. Para cada lançamento extraia:
   - customer_name: nome do cliente/sacado/pagador. Se vier "NOME - CPF/CNPJ", separe.
   - tax_id: CPF (11 dígitos) ou CNPJ (14 dígitos), apenas dígitos. Use "" se não houver.
   - description: histórico/descrição/título. Curto (até 80 chars). Use "" se não houver.
   - amount: valor em reais (número, ponto decimal). Sempre positivo.
   - due_date: vencimento ISO YYYY-MM-DD.
4. Ignore totalizadores, cabeçalhos, saldos, taxas e linhas sem cliente+valor+vencimento.
5. NUNCA invente. Se faltar vencimento OU valor, omita a linha.

RETORNE APENAS JSON VÁLIDO no formato:
{"items":[{"customer_name":"...","tax_id":"","description":"...","amount":0.00,"due_date":"YYYY-MM-DD"}],"total_count":N,"grand_total":N.NN}

Nada fora do JSON. Sem markdown, sem comentários.`;

function dedupKey(it: any) {
  return [
    (it.customer_name || "").trim().toLowerCase(),
    Number(it.amount).toFixed(2),
    String(it.due_date || "").slice(0, 10),
    (it.description || "").trim().toLowerCase(),
  ].join("|");
}

function brDateToISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseAmount(s: string): number {
  return Number(s.replace(/\./g, "").replace(",", "."));
}

// Extract text from PDF preserving line layout (similar to `pdftotext -layout`)
async function pdfToLayoutText(file_base64: string): Promise<string> {
  const bin = atob(file_base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const pdf = await getDocumentProxy(bytes);
  const lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group items by Y position (rounded), then sort by X within each row
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue;
      const tr = item.transform;
      const x = tr[4];
      const y = Math.round(tr[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, str: item.str });
    }
    const sortedYs = [...rows.keys()].sort((a, b) => b - a); // top to bottom
    for (const y of sortedYs) {
      const row = rows.get(y)!.sort((a, b) => a.x - b.x);
      let line = "";
      for (const r of row) {
        const colStart = Math.round(r.x / 4);
        const pad = Math.max(line.length === 0 ? colStart : colStart - line.length, line.length === 0 ? 0 : 1);
        line += " ".repeat(pad) + r.str;
      }
      lines.push(line);
    }
  }
  return lines.join("\n");
}

// Deterministic parser for Bling-style "Relatório de Contas a Receber"
function deterministicParseBling(text: string): any[] {
  const items: any[] = [];
  const patterns = [
    // client + history + CARTEIRA + doc + date + status + amount
    /^(\S.*?)\s{2,}(.+?)\s+CARTEIRA\s+(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+([\d\.,]+)\s*$/,
    // client + history + CARTEIRA + date + status + amount (no doc)
    /^(\S.*?)\s{2,}(.+?)\s+CARTEIRA\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+([\d\.,]+)\s*$/,
    // client only + CARTEIRA + date + status + amount
    /^(\S.*?)\s{2,}CARTEIRA\s+(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+([\d\.,]+)\s*$/,
  ];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.includes("CARTEIRA")) continue;
    if (/^Total/i.test(line.trim())) continue;
    if (/^(cliente|hist[oó]rico|relat[oó]rio de contas a receber|per[ií]odo)\b/i.test(line)) continue;

    let m: RegExpMatchArray | null = null;
    let groups: { client: string; desc: string; date: string; amount: string } | null = null;

    if ((m = line.match(patterns[0]))) {
      groups = { client: m[1], desc: m[2], date: m[4], amount: m[6] };
    } else if ((m = line.match(patterns[1]))) {
      groups = { client: m[1], desc: m[2], date: m[3], amount: m[5] };
    } else if ((m = line.match(patterns[2]))) {
      groups = { client: m[1], desc: "", date: m[2], amount: m[4] };
    }

    if (!groups) continue;
    const iso = brDateToISO(groups.date);
    const amt = parseAmount(groups.amount);
    if (!iso || !isFinite(amt) || amt <= 0) continue;

    items.push({
      customer_name: groups.client.trim(),
      tax_id: "",
      description: groups.desc.trim().slice(0, 120),
      amount: amt,
      due_date: iso,
    });
  }
  return items;
}

function parsePdfTotal(text: string): number | null {
  // e.g. "Total ... R$ 100.182,04"
  const m = text.match(/Total[\s\S]{0,200}R\$\s*([\d\.]+,\d{2})/i);
  if (!m) return null;
  return parseAmount(m[1]);
}

function extractJSON(raw: string): any {
  let cleaned = (raw || "")
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object in response");
  cleaned = cleaned.slice(start);
  try { return JSON.parse(cleaned); } catch {}
  const lastClose = cleaned.lastIndexOf("}");
  if (lastClose > 0) {
    const candidate = cleaned.slice(0, lastClose + 1);
    for (const tail of ["", "]}", "}]}"]) {
      try { return JSON.parse(candidate + tail); } catch {}
    }
  }
  throw new Error("Cannot parse JSON");
}

async function aiExtractPass(file_base64: string, filename: string, exclude: any[]): Promise<{ items: any[]; total_count?: number; grand_total?: number; finishReason?: string }> {
  const userText = exclude.length === 0
    ? "Extraia TODOS os lançamentos a receber deste PDF (todas as páginas). Inclua total_count e grand_total."
    : `Já extraí ${exclude.length} lançamentos. Continue do ponto onde parou. NÃO repita. Últimos extraídos:\n${exclude.slice(-8).map((e: any) => `- ${e.customer_name} | R$ ${e.amount} | ${e.due_date}`).join("\n")}\n\nRetorne APENAS os RESTANTES no mesmo formato JSON.`;

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "file", file: { filename: filename || "extrato.pdf", file_data: `data:application/pdf;base64,${file_base64}` } },
          ],
        },
      ],
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    console.error("AI gateway error", aiResp.status, errText);
    if (aiResp.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em alguns segundos.");
    if (aiResp.status === 402) throw new Error("Créditos esgotados na IA. Adicione créditos em Lovable AI.");
    throw new Error("AI error: " + errText.slice(0, 200));
  }
  const aiJson = await aiResp.json();
  const choice = aiJson.choices?.[0];
  const finishReason = choice?.finish_reason;
  const content = choice?.message?.content;
  if (!content) throw new Error("IA não retornou conteúdo");
  const parsed = extractJSON(content);
  return { items: Array.isArray(parsed.items) ? parsed.items : [], total_count: parsed.total_count, grand_total: parsed.grand_total, finishReason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { file_base64, filename } = await req.json();
    if (!file_base64 || typeof file_base64 !== "string") {
      return json({ error: "file_base64 required" }, 400);
    }

    // ---- 1) Try deterministic extraction (fast & precise for tabular PDFs) ----
    let allItems: any[] = [];
    let expectedGrand: number | null = null;
    let usedAI = false;

    try {
      const layoutText = await pdfToLayoutText(file_base64);
      expectedGrand = parsePdfTotal(layoutText);
      const detItems = deterministicParseBling(layoutText);
      const detSum = detItems.reduce((a, b) => a + b.amount, 0);
      console.log(`Deterministic: ${detItems.length} items, sum R$ ${detSum.toFixed(2)}, expected R$ ${expectedGrand ?? "?"}`);

      // Accept deterministic result if it captured at least 5 rows AND
      // (no expected total OR matches expected within 1%)
      if (detItems.length >= 5) {
        const closeEnough = expectedGrand == null || Math.abs(detSum - expectedGrand) / expectedGrand < 0.01;
        if (closeEnough) {
          allItems = detItems;
        }
      }
    } catch (e) {
      console.warn("Deterministic parse failed:", (e as Error).message);
    }

    // ---- 2) Fallback to AI if deterministic didn't yield a confident result ----
    if (allItems.length === 0) {
      usedAI = true;
      const seen = new Set<string>();
      const MAX_PASSES = 2;
      let expectedTotal: number | undefined;

      for (let pass = 0; pass < MAX_PASSES; pass++) {
        let passResult;
        try {
          passResult = await aiExtractPass(file_base64, filename, allItems);
        } catch (e) {
          if (pass === 0) throw e;
          console.warn("Continuation pass failed, stopping:", (e as Error).message);
          break;
        }
        const { items, total_count, grand_total, finishReason } = passResult;
        if (pass === 0) {
          expectedTotal = total_count;
          if (grand_total != null) expectedGrand = grand_total;
        }
        let added = 0;
        for (const it of items) {
          const k = dedupKey(it);
          if (seen.has(k)) continue;
          seen.add(k);
          allItems.push(it);
          added++;
        }
        console.log(`AI pass ${pass + 1}: received ${items.length}, added ${added}, total ${allItems.length}, finish=${finishReason}`);
        if (added === 0) break;
        if (expectedTotal && allItems.length >= expectedTotal) break;
        if (finishReason === "stop" && pass > 0) break;
      }
    }

    const sum = allItems.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    console.log(`FINAL (${usedAI ? "AI" : "deterministic"}): ${allItems.length} items, sum R$ ${sum.toFixed(2)}, expected R$ ${expectedGrand ?? "?"}`);

    return json({
      ok: true,
      items: allItems,
      meta: {
        extracted_count: allItems.length,
        extracted_sum: Number(sum.toFixed(2)),
        expected_count: null,
        expected_sum: expectedGrand,
        method: usedAI ? "ai" : "deterministic",
      },
    });
  } catch (e) {
    console.error("parse-receivables-pdf error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
