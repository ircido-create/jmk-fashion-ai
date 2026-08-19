import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  // Débitos de 15/08 que não foram cobrados hoje, limitando para evitar timeout
  const { data: overdue } = await supabase
    .from("accounts_receivable")
    .select("id, amount, due_date, description, customer_id, customers(name, phone)")
    .eq("status", "vencido")
    .eq("due_date", "2026-08-15")
    .not("customer_id", "is", null)
    .limit(10);

  let sent = 0;
  const url = `https://${DEVICE_ID}.bubblewhats.com/send-message`;
  
  for (const r of overdue ?? []) {
    const cust: any = (r as any).customers;
    const phone = String(cust?.phone || "").replace(/\D/g, "");
    if (!phone) continue;

    // Pula se for formato Meta legada ou tiver @
    if (phone.length < 10) continue;

    const { count } = await supabase
      .from("dunning_logs")
      .select("*", { count: "exact", head: true })
      .eq("receivable_id", r.id)
      .gte("sent_at", new Date(today).toISOString());
    
    if ((count ?? 0) > 0) continue;

    const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} que venceu em 15/08. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸`;

    const jid = `${phone}@s.whatsapp.net`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: BW_TOKEN, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ jid, message: msg }),
    });

    if (res.ok) {
      await supabase.from("dunning_logs").insert({
        customer_id: r.customer_id,
        receivable_id: r.id,
        message: msg,
        sent_at: new Date().toISOString()
      });
      sent++;
      // Espera 1s entre envios
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});
