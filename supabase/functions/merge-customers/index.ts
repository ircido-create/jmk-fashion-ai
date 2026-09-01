import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { requireAdmin, corsHeaders, deny } from "../_shared/auth.ts";

const BodySchema = z.object({
  keep_id: z.string().uuid(),
  drop_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Fundir clientes move o financeiro e apaga um cadastro em definitivo:
    // exige admin, não apenas um JWT válido de qualquer vendedor.
    await requireAdmin(req);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { keep_id, drop_id } = parsed.data;
    if (keep_id === drop_id) {
      return new Response(JSON.stringify({ error: "keep_id e drop_id iguais" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(url, service);

    const { data: pair, error: pairErr } = await admin
      .from("customers")
      .select("*")
      .in("id", [keep_id, drop_id]);
    if (pairErr || !pair || pair.length !== 2) {
      return new Response(JSON.stringify({ error: "Cliente não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const keep = pair.find((c: any) => c.id === keep_id)!;
    const drop = pair.find((c: any) => c.id === drop_id)!;

    // Merge missing fields into keep
    const fields = ["nickname", "tax_id", "phone", "email", "address", "notes"] as const;
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      if (!keep[f] && drop[f]) patch[f] = drop[f];
    }
    if (Object.keys(patch).length) {
      await admin.from("customers").update(patch).eq("id", keep_id);
    }

    // Move references
    const moves: Record<string, number> = {};
    for (const table of ["sales", "accounts_receivable"]) {
      const { error, count } = await admin
        .from(table)
        .update({ customer_id: keep_id }, { count: "exact" })
        .eq("customer_id", drop_id);
      if (error) {
        return new Response(JSON.stringify({ error: `Falha ao mover ${table}: ${error.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      moves[table] = count ?? 0;
    }

    // Delete the duplicate
    const { error: delErr } = await admin.from("customers").delete().eq("id", drop_id);
    if (delErr) {
      return new Response(JSON.stringify({ error: `Falha ao excluir duplicata: ${delErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, moves, patched: Object.keys(patch) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Response) return e; // 401/403 já formatados por requireAdmin
    return deny(500, (e as Error).message);
  }
});
