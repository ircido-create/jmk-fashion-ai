import { useEffect, useRef, useState } from "react";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MessageCircle, Send, Plus, Search, User, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Conversation {
  id: string;
  customer_phone: string;
  customer_id: string | null;
  last_message_at: string;
  customer?: { name: string } | null;
  lastMessage?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
}

export default function Conversations() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newMessage, setNewMessage] = useState("");
  // Cadastro de cliente a partir da conversa ativa
  const [regOpen, setRegOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regNotes, setRegNotes] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("id, customer_phone, customer_id, last_message_at, customers(name)")
      .order("last_message_at", { ascending: false });

    const list: Conversation[] = (data ?? []).map((c: any) => ({
      id: c.id,
      customer_phone: c.customer_phone,
      customer_id: c.customer_id,
      last_message_at: c.last_message_at,
      customer: c.customers,
    }));

    // Buscar última mensagem de cada
    for (const c of list) {
      const { data: m } = await supabase
        .from("whatsapp_messages")
        .select("content")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      c.lastMessage = m?.content;
    }
    setConversations(list);
  };

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages((data as any) ?? []);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
  };

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (active) loadMessages(active.id);
  }, [active?.id]);

  // Realtime: novas mensagens e atualizações de conversas
  useEffect(() => {
    const ch = supabase
      .channel("conv-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (active && msg.conversation_id === active.id) {
            setMessages((prev) =>
              prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]
            );
            setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
          }
          loadConversations();
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => loadConversations())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active?.id]);

  const send = async () => {
    if (!draft.trim() || !active) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { to: active.customer_phone, message: draft, save_history: true },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast({
        title: "Falha ao enviar",
        description: error?.message ?? JSON.stringify((data as any)?.error),
        variant: "destructive",
      });
    } else {
      setDraft("");
    }
  };

  const startConversation = async () => {
    const phone = newPhone.replace(/\D/g, "");
    if (!phone || !newMessage.trim()) {
      toast({ title: "Preencha telefone e mensagem", variant: "destructive" });
      return;
    }
    // Cadastrar cliente se nome informado e ainda não existir
    if (newName.trim()) {
      const { data: existing } = await supabase
        .from("customers").select("id").eq("phone", phone).maybeSingle();
      if (!existing) {
        await supabase.from("customers").insert({ name: newName, phone });
      }
    }
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: { to: phone, message: newMessage, save_history: true },
    });
    if (error || (data as any)?.error) {
      toast({
        title: "Falha",
        description: error?.message ?? JSON.stringify((data as any)?.error),
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Conversa iniciada 💕" });
    setNewOpen(false);
    setNewPhone(""); setNewName(""); setNewMessage("");
    await loadConversations();
  };

  const openRegister = () => {
    if (!active) return;
    setRegName(active.customer?.name ?? "");
    setRegEmail("");
    setRegAddress("");
    setRegNotes("");
    setRegOpen(true);
  };

  const registerCustomer = async () => {
    if (!active) return;
    if (!regName.trim()) {
      toast({ title: "Informe o nome do cliente", variant: "destructive" });
      return;
    }
    setRegSaving(true);
    const phone = active.customer_phone;

    // Verifica se já existe cliente com este telefone
    const { data: existing } = await supabase
      .from("customers").select("id").eq("phone", phone).maybeSingle();

    let customerId = existing?.id;
    if (existing) {
      const { error } = await supabase.from("customers").update({
        name: regName,
        email: regEmail || null,
        address: regAddress || null,
        notes: regNotes || null,
      }).eq("id", existing.id);
      if (error) {
        setRegSaving(false);
        toast({ title: "Falha ao atualizar cliente", description: error.message, variant: "destructive" });
        return;
      }
    } else {
      const { data: created, error } = await supabase.from("customers").insert({
        name: regName,
        phone,
        email: regEmail || null,
        address: regAddress || null,
        notes: regNotes || null,
      }).select("id").single();
      if (error) {
        setRegSaving(false);
        toast({ title: "Falha ao cadastrar cliente", description: error.message, variant: "destructive" });
        return;
      }
      customerId = created.id;
    }

    // Vincula a conversa ao cliente
    await supabase.from("whatsapp_conversations")
      .update({ customer_id: customerId })
      .eq("id", active.id);

    setRegSaving(false);
    setRegOpen(false);
    toast({ title: "Cliente salvo 💕" });
    await loadConversations();
    // Atualiza a conversa ativa em memória
    setActive({ ...active, customer_id: customerId!, customer: { name: regName } });
  };

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.customer_phone.toLowerCase().includes(q) ||
      (c.customer?.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Conversas"
        description="Histórico WhatsApp em tempo real e envio direto"
        actions={
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary">
                <Plus className="h-4 w-4 mr-2" />Nova conversa
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-card">
              <DialogHeader>
                <DialogTitle>Iniciar conversa</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Telefone (com DDI, ex: 5511999999999)</Label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                </div>
                <div>
                  <Label>Nome do cliente (opcional, será cadastrado)</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label>Mensagem</Label>
                  <Textarea rows={3} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={startConversation} className="bg-gradient-primary">
                  <Send className="h-4 w-4 mr-2" />Enviar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-220px)]">
        {/* Lista */}
        <GlassCard className="flex flex-col p-0 overflow-hidden">
          <div className="p-3 border-b border-white/30">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar nome ou telefone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center text-muted-foreground text-sm p-8">
                Nenhuma conversa ainda
              </div>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className={cn(
                  "w-full text-left p-3 border-b border-white/20 hover:bg-white/40 transition",
                  active?.id === c.id && "bg-gradient-primary/20"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-medium text-sm truncate">
                        {c.customer?.name ?? c.customer_phone}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(c.last_message_at), { locale: ptBR, addSuffix: false })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.lastMessage ?? c.customer_phone}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Painel da conversa */}
        <GlassCard className="flex flex-col p-0 overflow-hidden">
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-20 w-20 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow mb-4">
                <MessageCircle className="h-10 w-10 text-primary-foreground" />
              </div>
              <h3 className="font-display font-bold text-lg gradient-text">Selecione uma conversa</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-xs">
                Veja o histórico, responda manualmente ou inicie uma nova conversa com um cliente.
              </p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/30 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{active.customer?.name ?? "Cliente"}</div>
                  <div className="text-xs text-muted-foreground">{active.customer_phone}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openRegister}
                  className="shrink-0"
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  {active.customer_id ? "Editar cliente" : "Cadastrar cliente"}
                </Button>
              </div>

              {/* Dialog de cadastro/edição de cliente */}
              <Dialog open={regOpen} onOpenChange={setRegOpen}>
                <DialogContent className="glass-card">
                  <DialogHeader>
                    <DialogTitle>
                      {active.customer_id ? "Editar cliente" : "Cadastrar cliente"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Nome *</Label>
                      <Input value={regName} onChange={(e) => setRegName(e.target.value)} />
                    </div>
                    <div>
                      <Label>Telefone</Label>
                      <Input value={active.customer_phone} disabled />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
                    </div>
                    <div>
                      <Label>Endereço</Label>
                      <Textarea rows={2} value={regAddress} onChange={(e) => setRegAddress(e.target.value)} />
                    </div>
                    <div>
                      <Label>Observações</Label>
                      <Textarea rows={2} value={regNotes} onChange={(e) => setRegNotes(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={registerCustomer} disabled={regSaving} className="bg-gradient-primary">
                      {regSaving ? "Salvando…" : "Salvar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>


              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    Sem mensagens ainda
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.direction === "outbound" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] px-4 py-2 rounded-2xl text-sm shadow-sm",
                        m.direction === "outbound"
                          ? "bg-gradient-primary text-primary-foreground rounded-br-sm"
                          : "bg-white/80 backdrop-blur rounded-bl-sm"
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      <div
                        className={cn(
                          "text-[10px] mt-1 opacity-70",
                          m.direction === "outbound" ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}
                      >
                        {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-white/30 flex gap-2">
                <Textarea
                  placeholder="Digite sua mensagem…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault(); send();
                    }
                  }}
                  rows={2}
                  className="resize-none"
                />
                <Button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="bg-gradient-primary self-end"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
