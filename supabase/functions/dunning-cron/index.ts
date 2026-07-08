// Cobrança automática diária via BubbleWhats
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
    const deviceId = Deno.env.get("BUBBLEWHATS_DEVICE_ID");
    const bwToken = Deno.env.get("BUBBLEWHATS_TOKEN");
    if (!deviceId || !bwToken) {
      return new Response(JSON.stringify({ skipped: "BubbleWhats não configurado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    const url = `https://${deviceId}.bubblewhats.com/send-message`;
    for (const r of overdue ?? []) {
      const cust: any = (r as any).customers;
      if (!cust?.phone) continue;

      const { count } = await supabase
        .from("dunning_logs")
        .select("*", { count: "exact", head: true })
        .eq("receivable_id", r.id)
        .gte("sent_at", new Date(today).toISOString());
      if ((count ?? 0) > 0) continue;

      const dueBR = (() => {
        const m = String(r.due_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(r.due_date);
      })();
      const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} (${r.description ?? "sua comprinha"}) que venceu em ${dueBR}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸`;

      const jid = String(cust.phone).replace(/\D/g, "");
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: bwToken, "Content-Type": "application/json" },
        body: JSON.stringify({ jid, message: msg }),
      });

      if (res.ok) {
        await supabase.from("dunning_logs").insert({
          customer_id: r.customer_id,
          receivable_id: r.id,
          message: msg,
        });
        sent++;
      } else {
        console.error("Falha envio BubbleWhats:", jid, res.status, await res.text());
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
