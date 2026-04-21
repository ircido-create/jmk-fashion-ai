import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { MessageSquare, Sparkles, Clock } from "lucide-react";

export default function WhatsApp() {
  return (
    <div>
      <PageHeader title="WhatsApp + IA" description="Atendimento automático com inteligência artificial" />

      <GlassCard className="text-center py-12">
        <div className="inline-flex h-20 w-20 rounded-2xl bg-gradient-primary items-center justify-center shadow-glow mb-4">
          <MessageSquare className="h-10 w-10 text-primary-foreground" />
        </div>
        <h2 className="text-2xl font-display font-bold gradient-text mb-2">Em breve — Fase 2</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          A integração com a <strong>API Oficial Meta WhatsApp Business</strong> + IA para atendimento automático
          (responder preços, tamanhos, cobrança de inadimplentes, regra "Amém") está pronta para ser ativada
          assim que você fornecer os tokens da Meta.
        </p>

        <div className="grid sm:grid-cols-3 gap-3 mt-8 max-w-2xl mx-auto text-left">
          {[
            { icon: Sparkles, t: "Atendimento inteligente", d: "Responde preços, tamanhos e cores do seu estoque" },
            { icon: Clock, t: "Cobrança automática", d: "Mensagem cordial diária para inadimplentes" },
            { icon: MessageSquare, t: "Histórico no painel", d: "Veja todas as conversas em tempo real" },
          ].map((f) => (
            <div key={f.t} className="p-4 rounded-2xl bg-white/40 backdrop-blur">
              <f.icon className="h-6 w-6 text-primary mb-2" />
              <div className="font-medium text-sm">{f.t}</div>
              <div className="text-xs text-muted-foreground mt-1">{f.d}</div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
