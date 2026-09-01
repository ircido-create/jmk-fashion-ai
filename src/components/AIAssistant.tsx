import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircleQuestion, X, Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Msg { role: "user" | "assistant"; content: string; }

export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Olá! 💜 Sou sua assistente do JMK ADM. Posso te ajudar a usar o sistema. Como posso ajudar?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Msg = { role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: [...messages, userMsg] },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        setMessages((m) => [...m, { role: "assistant", content: "Desculpe, tive um problema. Tente novamente." }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.reply || "..." }]);
      }
    } catch (e: any) {
      toast.error("Erro ao falar com a assistente");
      setMessages((m) => [...m, { role: "assistant", content: "Não consegui responder agora. Tente em instantes." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!hidden && (
        <div className="fixed bottom-6 right-6 z-40">
          <motion.button
            onClick={() => setOpen(true)}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            className="relative h-14 w-14 rounded-full bg-gradient-primary text-primary-foreground shadow-glow flex items-center justify-center"
            aria-label="Abrir assistente"
          >
            <Sparkles className="h-6 w-6" />
            <span className="absolute inset-0 rounded-full bg-gradient-primary animate-ping opacity-20" />
          </motion.button>
          <button
            onClick={(e) => { e.stopPropagation(); setHidden(true); setOpen(false); }}
            aria-label="Ocultar assistente"
            className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background border border-border text-foreground/70 hover:text-foreground hover:bg-muted shadow-sm flex items-center justify-center transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-4 md:right-6 z-50 w-[calc(100vw-2rem)] sm:w-96 h-[520px] glass-card flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-border flex items-center justify-between bg-gradient-primary text-primary-foreground">
              <div className="flex items-center gap-2">
                <MessageCircleQuestion className="h-5 w-5" />
                <div>
                  <div className="font-semibold text-sm">Assistente JMK</div>
                  <div className="text-[11px] opacity-80">Tire suas dúvidas</div>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setOpen(false)} className="text-primary-foreground hover:bg-white/20 h-8 w-8" aria-label="Fechar assistente">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-gradient-primary text-primary-foreground rounded-br-sm"
                      : "bg-white/70 backdrop-blur text-foreground rounded-bl-sm"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white/70 backdrop-blur rounded-2xl px-3.5 py-2.5">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Sua dúvida..."
                className="flex-1 px-3 py-2 text-sm rounded-xl glass-input focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="bg-gradient-primary text-primary-foreground rounded-xl" aria-label="Enviar mensagem">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
