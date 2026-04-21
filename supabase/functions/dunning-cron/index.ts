// Cobrança automática diária - envia mensagem cordial a inadimplentes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { data: cfg } = await supabase.from("whatsapp_config").select("*").maybeSingle();
    if (!cfg?.enabled || !cfg.access_token || !cfg.phone_number_id) {
      return new Response(JSON.stringify({ skipped: "WhatsApp não configurado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Marca como vencido e busca inadimplentes
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from("accounts_receivable")
      .update({ status: "vencido" })
      .lt("due_date", today)
      .eq("status", "pendente");

    const { data: overdue } = await supabase
      .from("accounts_receivable")
      .select("id, amount, due_date, description, customer_id, customers(name, phone)")
      .eq("status", "vencido")
      .not("customer_id", "is", null);

    let sent = 0;
    for (const r of overdue ?? []) {
      const cust: any = (r as any).customers;
      if (!cust?.phone) continue;

      // Evita duplicar no mesmo dia
      const { count } = await supabase
        .from("dunning_logs")
        .select("*", { count: "exact", head: true })
        .eq("receivable_id", r.id)
        .gte("sent_at", new Date(today).toISOString());
      if ((count ?? 0) > 0) continue;

      const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} (${r.description ?? "sua comprinha"}) que venceu em ${r.due_date}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸`;

      const url = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: cust.phone,
          type: "text",
          text: { body: msg },
        }),
      });

      if (res.ok) {
        await supabase.from("dunning_logs").insert({
          customer_id: r.customer_id,
          receivable_id: r.id,
          message: msg,
        });
        sent++;
      } else {
        console.error("Falha envio:", cust.phone, await res.text());
      }
    }

    return new Response(JSON.stringify({ sent, total: overdue?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
