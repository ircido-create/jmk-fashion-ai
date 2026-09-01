import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, corsHeaders, deny } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_ID = Deno.env.get("BUBBLEWHATS_DEVICE_ID")!;
const BW_TOKEN = Deno.env.get("BUBBLEWHATS_TOKEN")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Dispara WhatsApp real para clientes e devolve nome/telefone deles: só admin.
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return deny(500, (e as Error).message);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  const { data: overdue } = await supabase
    .from("accounts_receivable")
    .select("id, amount, due_date, description, customer_id, customers(name, phone)")
    .eq("status", "vencido")
    .eq("due_date", "2026-08-15")
    .not("customer_id", "is", null)
    .limit(5);

  let results = [];
  const url = `https://${DEVICE_ID}.bubblewhats.com/send-message`;
  
  for (const r of overdue ?? []) {
    const cust: any = (r as any).customers;
    const phone = String(cust?.phone || "").replace(/\D/g, "");
    
    // Log detalhado do que está acontecendo
    const { count } = await supabase
      .from("dunning_logs")
      .select("*", { count: "exact", head: true })
      .eq("receivable_id", r.id)
      .gte("sent_at", new Date(today).toISOString());
    
    results.push({
      id: r.id,
      name: cust.name,
      phone: phone,
      already_sent_today: (count ?? 0) > 0
    });

    if ((count ?? 0) === 0 && phone.length >= 10) {
      const msg = `Olá, ${cust.name} 💕 Aqui é da JMK! Passando para te lembrar do pagamento de R$ ${r.amount} que venceu em 15/08. Que Deus te abençoe! 🌸`;
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
      }
    }
  }

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
