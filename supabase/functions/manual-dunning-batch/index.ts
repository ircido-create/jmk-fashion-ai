import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Débitos de 15/08 que não foram cobrados hoje
  const { data: overdue } = await supabase
    .from("accounts_receivable")
    .select("id, amount, due_date, description, customer_id, customers(name, phone)")
    .eq("status", "vencido")
    .eq("due_date", "2026-08-15")
    .not("customer_id", "is", null);

  let sent = 0;
  const url = `https://${DEVICE_ID}.bubblewhats.com/send-message`;
  
  for (const r of overdue ?? []) {
    const cust: any = (r as any).customers;
    const phone = String(cust?.phone || "").replace(/\D/g, "");
    if (!phone) continue;

    // Verifica se já cobrou hoje
    const { count } = await supabase
      .from("dunning_logs")
      .select("*", { count: "exact", head: true })
      .eq("receivable_id", r.id)
      .gte("sent_at", new Date(today).toISOString());
    
    if ((count ?? 0) > 0) continue;

    const dueBR = "15/08/2026";
    const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando com muito carinho para te lembrar do pagamento de R$ ${r.amount} (${r.description ?? "sua comprinha"}) que venceu em ${dueBR}. Qualquer dúvida estou por aqui, tá? Que Deus te abençoe! 🌸\n\n👉🏻 Caso tenha efetuado o pagamento, desconsidere este lembrete!`;

    const jid = `${phone}@s.whatsapp.net`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: BW_TOKEN, "Content-Type": "application/json" },
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
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});
