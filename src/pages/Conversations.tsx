import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { GlassCard } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatTaxId } from "@/lib/taxId";
import {
  MessageCircle, Send, Plus, Search, User, UserPlus, ArrowLeft, Paperclip,
  Image as ImageIcon, FileText, Mic, X, Download,
  Smile, Check, ChevronsUpDown, Link2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import { convertToMp3 } from "@/lib/audioToMp3";
import { FavoriteStickers } from "@/components/FavoriteStickers";

interface Conversation {
  id: string;
  customer_phone: string;
  customer_id: string | null;
  last_message_at: string;
  display_name?: string | null;
  customer?: { name: string } | null;
  lastMessage?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
  media_path: string | null;
  media_type: "image" | "audio" | "document" | "video" | "sticker" | null;
  media_mime: string | null;
  media_filename: string | null;
  quoted_thumbnail_path?: string | null;
  quoted_is_status?: boolean | null;
  quoted_caption?: string | null;
}

const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const isMediaPlaceholder = (content?: string | null) =>
  !!content && /^\[(?:(?:📷|🎤|📎|🎥)|(?:.*\b(?:Figurinha|Sticker|Imagem|Áudio|Audio|Documento|V[ií]deo)\b.*))\]$/i.test(content.trim());

// Nomes "placeholder" que vieram do auto-cadastro do WhatsApp quando ainda não sabemos o nome real.
const isPlaceholderName = (name?: string | null) => {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (n === "(sem nome)") return true;
  if (/^\+?[0-9 ().-]+$/.test(n)) return true; // só dígitos/telefone
  return false;
};
const displayName = (c: { display_name?: string | null; customer?: { name: string } | null; customer_phone: string }) => {
  // Prioriza o nome cadastrado no sistema (quando não for placeholder/telefone)
  if (c.customer?.name && !isPlaceholderName(c.customer.name)) return c.customer.name;
  if (c.display_name && c.display_name.trim()) return c.display_name;
  return c.customer_phone;
};

function MediaBubble({
  msg, signedUrl,
}: { msg: Message; signedUrl?: string }) {
  if (!msg.media_path || !msg.media_type) return null;

  if (msg.media_type === "image") {
    return signedUrl ? (
      <a href={signedUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={signedUrl}
          alt={msg.media_filename ?? "imagem"}
          className="rounded-lg max-h-64 w-auto object-cover"
          loading="lazy"
        />
      </a>
    ) : (
      <div className="h-32 w-48 rounded-lg bg-muted/50 animate-pulse" />
    );
  }

  if (msg.media_type === "audio") {
    return signedUrl ? (
      <audio
        controls
        preload="metadata"
        className="block w-[260px] sm:w-[300px] h-10"
      >
        <source src={signedUrl} type={msg.media_mime ?? "audio/mpeg"} />
      </audio>
    ) : (
      <div className="h-10 w-[260px] rounded-full bg-muted/50 animate-pulse" />
    );
  }

  if (msg.media_type === "sticker") {
    return signedUrl ? (
      <img
        src={signedUrl}
        alt="figurinha"
        className="w-32 h-32 object-contain"
        loading="lazy"
      />
    ) : (
      <div className="h-32 w-32 rounded-lg bg-muted/50 animate-pulse" />
    );
  }

  if (msg.media_type === "video") {
    return signedUrl ? (
      <video controls preload="metadata" className="rounded-lg max-h-64 w-auto">
        <source src={signedUrl} type={msg.media_mime ?? "video/mp4"} />
      </video>
    ) : (
      <div className="h-40 w-56 rounded-lg bg-muted/50 animate-pulse" />
    );
  }

  // document
  return (
    <a
      href={signedUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 p-2 rounded-lg bg-background/40 hover:bg-background/60 transition min-w-[180px]"
    >
      <div className="h-10 w-10 rounded-md bg-gradient-primary flex items-center justify-center shrink-0">
        <FileText className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{msg.media_filename ?? "Documento"}</div>
        <div className="text-[10px] opacity-70">{msg.media_mime}</div>
      </div>
      {signedUrl && <Download className="h-4 w-4 opacity-70 shrink-0" />}
    </a>
  );
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
  const [regOpen, setRegOpen] = useState(false);
  const [regMode, setRegMode] = useState<"new" | "link">("new");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regNotes, setRegNotes] = useState("");
  const [regSaving, setRegSaving] = useState(false);
  const [allCustomers, setAllCustomers] = useState<Array<{ id: string; name: string; phone: string | null; tax_id: string | null }>>([]);
  const [linkCustomerId, setLinkCustomerId] = useState<string>("");
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  // mídia URLs assinadas (path -> url)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});

  // gravador de áudio
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const loadConversations = async () => {
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("id, customer_phone, customer_id, last_message_at, display_name, customers(name)")
      .order("last_message_at", { ascending: false });

    const list: Conversation[] = (data ?? []).map((c: any) => ({
      id: c.id,
      customer_phone: c.customer_phone,
      customer_id: c.customer_id,
      last_message_at: c.last_message_at,
      display_name: c.display_name,
      customer: c.customers,
    }));

    for (const c of list) {
      const { data: m } = await supabase
        .from("whatsapp_messages")
        .select("content")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      c.lastMessage = isMediaPlaceholder(m?.content) ? "" : m?.content;
    }
    setConversations(list);
  };

  const fetchSignedUrls = async (msgs: Message[]) => {
    const paths = [
      ...msgs.map((m) => m.media_path),
      ...msgs.map((m) => m.quoted_thumbnail_path ?? null),
    ].filter((p): p is string => !!p && !mediaUrls[p]);
    if (paths.length === 0) return;
    const { data } = await supabase.functions.invoke("whatsapp-media-url", { body: { paths } });
    const urls = (data as any)?.urls ?? {};
    setMediaUrls((prev) => ({ ...prev, ...urls }));
  };

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    const list = (data as any as Message[]) ?? [];
    setMessages(list);
    fetchSignedUrls(list);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { if (active) loadMessages(active.id); }, [active?.id]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("conv-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (active && msg.conversation_id === active.id) {
            setMessages((prev) => prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]);
            if (msg.media_path) fetchSignedUrls([msg]);
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

  const sendMedia = async (
    file: File,
    kind: "image" | "audio" | "document" | "sticker",
  ) => {
    if (!active) return;
    setSending(true);

    // Preview otimista local
    const tempId = `temp-${Date.now()}`;
    const localUrl = URL.createObjectURL(file);
    const tempPath = `__local__/${tempId}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: active.id,
      direction: "outbound",
      content: draft.trim() || "",
      created_at: new Date().toISOString(),
      media_path: tempPath,
      media_type: kind,
      media_mime: file.type || null,
      media_filename: file.name,
    };
    setMessages((prev) => [...prev, optimistic]);
    setMediaUrls((prev) => ({ ...prev, [tempPath]: localUrl }));
    setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 30);

    try {
      const base64 = await fileToBase64(file);
      const fallbackMime =
        kind === "audio" ? "audio/mpeg"
        : kind === "sticker" ? "image/webp"
        : kind === "image" ? "image/jpeg"
        : "application/octet-stream";
      const { data, error } = await supabase.functions.invoke("whatsapp-send-media", {
        body: {
          to: active.customer_phone,
          kind,
          file_base64: base64,
          mime_type: file.type || fallbackMime,
          filename: file.name,
          caption: kind === "sticker" || kind === "audio" ? undefined : draft.trim() || undefined,
        },
      });
      if (error || (data as any)?.error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        URL.revokeObjectURL(localUrl);
        toast({
          title: "Falha ao enviar arquivo",
          description: error?.message ?? JSON.stringify((data as any)?.error),
          variant: "destructive",
        });
      } else {
        if (kind !== "sticker" && kind !== "audio") setDraft("");
        setTimeout(() => {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          URL.revokeObjectURL(localUrl);
        }, 1500);
      }
    } finally {
      setSending(false);
    }
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) sendMedia(f, "image");
  };
  const onPickDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) sendMedia(f, "document");
  };
  const insertEmoji = (emoji: string) => {
    setDraft((d) => d + emoji);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Grava no formato nativo do navegador, depois converte para MP3 (audio/mpeg),
      // formato aceito universalmente pela Meta WhatsApp Cloud API.
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const rawType = mr.mimeType || "audio/webm";
        const raw = new Blob(chunksRef.current, { type: rawType });
        try {
          const mp3 = await convertToMp3(raw);
          const file = new File([mp3], `audio-${Date.now()}.mp3`, { type: "audio/mpeg" });
          await sendMedia(file, "audio");
        } catch (err: any) {
          toast({
            title: "Falha ao processar áudio",
            description: err?.message ?? "Não foi possível converter para MP3",
            variant: "destructive",
          });
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecElapsed(0);
      recTimerRef.current = window.setInterval(() => setRecElapsed((s) => s + 1), 1000);
    } catch (err: any) {
      toast({ title: "Microfone bloqueado", description: err?.message ?? "Permissão negada", variant: "destructive" });
    }
  };
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  };
  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  };

  const startConversation = async () => {
    const phone = newPhone.replace(/\D/g, "");
    if (!phone || !newMessage.trim()) {
      toast({ title: "Preencha telefone e mensagem", variant: "destructive" });
      return;
    }
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

  const openRegister = async () => {
    if (!active) return;
    setRegMode("new");
    setLinkCustomerId("");
    setRegName(isPlaceholderName(active.customer?.name) ? "" : (active.customer?.name ?? ""));
    setRegEmail("");
    setRegAddress("");
    setRegNotes("");
    setRegOpen(true);
    // Carrega lista de clientes existentes para o seletor de vínculo
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, tax_id")
      .order("name", { ascending: true });
    setAllCustomers((data ?? []) as any);
  };

  const registerCustomer = async () => {
    if (!active) return;

    // Modo "vincular": apenas associa um cliente já cadastrado a esta conversa
    if (regMode === "link") {
      if (!linkCustomerId) {
        toast({ title: "Selecione um cliente", variant: "destructive" });
        return;
      }
      setRegSaving(true);
      const picked = allCustomers.find((c) => c.id === linkCustomerId);
      // Atualiza o telefone do cliente selecionado para o número desta conversa, caso esteja vazio
      if (picked && !picked.phone) {
        await supabase.from("customers").update({ phone: active.customer_phone }).eq("id", picked.id);
      }
      const { error } = await supabase.from("whatsapp_conversations")
        .update({ customer_id: linkCustomerId })
        .eq("id", active.id);
      setRegSaving(false);
      if (error) {
        toast({ title: "Falha ao vincular cliente", description: error.message, variant: "destructive" });
        return;
      }
      setRegOpen(false);
      toast({ title: "Cliente vinculado 💕" });
      await loadConversations();
      setActive({ ...active, customer_id: linkCustomerId, customer: { name: picked?.name ?? "" } });
      return;
    }

    // Modo "novo/editar"
    if (!regName.trim()) {
      toast({ title: "Informe o nome do cliente", variant: "destructive" });
      return;
    }
    setRegSaving(true);
    const phone = active.customer_phone;

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
        name: regName, phone, email: regEmail || null, address: regAddress || null, notes: regNotes || null,
      }).select("id").single();
      if (error) {
        setRegSaving(false);
        toast({ title: "Falha ao cadastrar cliente", description: error.message, variant: "destructive" });
        return;
      }
      customerId = created.id;
    }

    await supabase.from("whatsapp_conversations")
      .update({ customer_id: customerId })
      .eq("id", active.id);

    setRegSaving(false);
    setRegOpen(false);
    toast({ title: "Cliente salvo 💕" });
    await loadConversations();
    setActive({ ...active, customer_id: customerId!, customer: { name: regName } });
  };

  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = useMemo(() => conversations.filter((c) => {
    const q = debouncedSearch.toLowerCase();
    const name = isPlaceholderName(c.customer?.name) ? "" : (c.customer?.name ?? "");
    return (
      c.customer_phone.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q)
    );
  }), [conversations, debouncedSearch]);

  const formatRecTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  };

  return (
    <div className="-m-4 md:m-0">
      {/* Header da página: só aparece no desktop ou quando não tem conversa ativa no mobile */}
      <div className={cn(
        "px-4 md:px-0 pt-4 md:pt-0 mb-4 md:mb-6",
        "flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 animate-fade-in",
        active && "hidden md:flex",
      )}>
        <div>
          <h1 className="text-2xl md:text-4xl font-display font-bold gradient-text">Conversas</h1>
          <p className="text-muted-foreground mt-1 text-xs md:text-sm">
            Histórico WhatsApp em tempo real e envio direto
          </p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary">
              <Plus className="h-4 w-4 mr-2" />Nova conversa
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-card">
            <DialogHeader><DialogTitle>Iniciar conversa</DialogTitle></DialogHeader>
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
      </div>

      {/* CONTAINER PRINCIPAL */}
      <div className="grid md:grid-cols-[320px_1fr] md:gap-4 h-[calc(100vh-64px)] md:h-[calc(100vh-220px)]">
        {/* === LISTA === */}
        <GlassCard className={cn(
          "flex flex-col p-0 overflow-hidden rounded-none md:rounded-2xl",
          "h-full",
          active && "hidden md:flex",
        )}>
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
                  <div className="h-11 w-11 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-medium text-sm truncate">
                        {displayName(c)}
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

          {/* FAB nova conversa (mobile) */}
          <button
            onClick={() => setNewOpen(true)}
            className="md:hidden absolute bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-primary shadow-glow flex items-center justify-center"
            aria-label="Nova conversa"
          >
            <Plus className="h-6 w-6 text-primary-foreground" />
          </button>
        </GlassCard>

        {/* === PAINEL DA CONVERSA === */}
        <GlassCard className={cn(
          "flex flex-col p-0 overflow-hidden rounded-none md:rounded-2xl",
          "h-full",
          !active && "hidden md:flex",
        )}>
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
              {/* Header da conversa estilo WhatsApp */}
              <div className="px-3 py-2.5 border-b border-white/30 flex items-center gap-2 bg-gradient-to-r from-primary/10 to-transparent">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-9 w-9 shrink-0"
                  onClick={() => setActive(null)}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-sm">{displayName(active)}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{active.customer_phone}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openRegister}
                  className="shrink-0 hidden sm:inline-flex"
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  {active.customer_id ? "Editar" : "Cadastrar"}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={openRegister}
                  className="shrink-0 sm:hidden h-9 w-9"
                  aria-label="Cadastrar cliente"
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>

              {/* Dialog cadastrar / vincular */}
              <Dialog open={regOpen} onOpenChange={setRegOpen}>
                <DialogContent className="glass-card">
                  <DialogHeader>
                    <DialogTitle>
                      {active.customer_id
                        ? "Editar cliente"
                        : regMode === "link" ? "Vincular cliente" : "Cadastrar cliente"}
                    </DialogTitle>
                  </DialogHeader>

                  {/* Alternador novo / vincular — só faz sentido quando ainda não há cliente vinculado */}
                  {!active.customer_id && (
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/40">
                      <button
                        type="button"
                        onClick={() => setRegMode("new")}
                        className={cn(
                          "text-xs font-medium py-2 rounded-md transition flex items-center justify-center gap-1.5",
                          regMode === "new" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Cadastrar novo
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegMode("link")}
                        className={cn(
                          "text-xs font-medium py-2 rounded-md transition flex items-center justify-center gap-1.5",
                          regMode === "link" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Vincular existente
                      </button>
                    </div>
                  )}

                  {regMode === "link" && !active.customer_id ? (
                    <div className="space-y-3">
                      <div>
                        <Label>Cliente já cadastrado</Label>
                        <Popover open={linkPickerOpen} onOpenChange={setLinkPickerOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between font-normal"
                            >
                              {linkCustomerId
                                ? (() => {
                                    const c = allCustomers.find((x) => x.id === linkCustomerId);
                                    if (!c) return "Selecione um cliente…";
                                    const tax = c.tax_id ? ` • ${formatTaxId(c.tax_id)}` : "";
                                    return `${c.name}${tax}`;
                                  })()
                                : "Selecione um cliente…"}
                              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                            <Command
                              filter={(value, search) => {
                                // value contém "nome|tax|phone" — match em qualquer um, sem pontuação
                                const v = value.toLowerCase();
                                const s = search.toLowerCase();
                                const sDigits = s.replace(/\D/g, "");
                                if (v.includes(s)) return 1;
                                if (sDigits && v.replace(/\D/g, "").includes(sDigits)) return 1;
                                return 0;
                              }}
                            >
                              <CommandInput placeholder="Buscar por nome, CPF ou telefone…" />
                              <CommandList>
                                <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                                <CommandGroup>
                                  {allCustomers.map((c) => (
                                    <CommandItem
                                      key={c.id}
                                      value={`${c.name}|${c.tax_id ?? ""}|${c.phone ?? ""}`}
                                      onSelect={() => {
                                        setLinkCustomerId(c.id);
                                        setLinkPickerOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "h-4 w-4 mr-2",
                                          linkCustomerId === c.id ? "opacity-100" : "opacity-0",
                                        )}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm truncate">{c.name}</div>
                                        <div className="text-[11px] text-muted-foreground truncate">
                                          {[c.tax_id ? formatTaxId(c.tax_id) : null, c.phone].filter(Boolean).join(" • ")}
                                        </div>
                                      </div>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          O número <span className="font-mono">{active.customer_phone}</span> será associado a este cliente.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div><Label>Nome *</Label><Input value={regName} onChange={(e) => setRegName(e.target.value)} /></div>
                      <div><Label>Telefone</Label><Input value={active.customer_phone} disabled /></div>
                      <div><Label>Email</Label><Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} /></div>
                      <div><Label>Endereço</Label><Textarea rows={2} value={regAddress} onChange={(e) => setRegAddress(e.target.value)} /></div>
                      <div><Label>Observações</Label><Textarea rows={2} value={regNotes} onChange={(e) => setRegNotes(e.target.value)} /></div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button onClick={registerCustomer} disabled={regSaving} className="bg-gradient-primary">
                      {regSaving
                        ? "Salvando…"
                        : regMode === "link" && !active.customer_id ? "Vincular" : "Salvar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Mensagens — fundo estilo WhatsApp */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-1.5"
                style={{
                  backgroundImage:
                    "radial-gradient(hsl(var(--primary) / 0.06) 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                }}
              >
                {messages.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    Sem mensagens ainda
                  </div>
                )}
                {messages.map((m) => {
                  const isOut = m.direction === "outbound";
                  const url = m.media_path ? mediaUrls[m.media_path] : undefined;
                  const showText = !!m.content && !isMediaPlaceholder(m.content);
                  return (
                    <div key={m.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[85%] sm:max-w-[75%] px-2.5 py-2 rounded-2xl text-sm shadow-sm space-y-1.5",
                          isOut
                            ? "bg-gradient-primary text-primary-foreground rounded-br-sm"
                            : "bg-white/90 dark:bg-card/90 backdrop-blur rounded-bl-sm",
                        )}
                      >
                        {m.media_path && <MediaBubble msg={m} signedUrl={url} />}
                        {showText && (
                          <div className="whitespace-pre-wrap break-words px-1">{m.content}</div>
                        )}
                        <div
                          className={cn(
                            "text-[10px] opacity-70 text-right px-1",
                            isOut ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer estilo WhatsApp */}
              <div className="p-2 border-t border-white/30 bg-background/40">
                {recording ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={cancelRecording} className="text-destructive" aria-label="Cancelar gravação">
                      <X className="h-5 w-5" />
                    </Button>
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full bg-destructive/10">
                      <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
                      <span className="text-sm font-mono">{formatRecTime(recElapsed)}</span>
                      <span className="text-xs text-muted-foreground">Gravando…</span>
                    </div>
                    <Button onClick={stopRecording} className="bg-gradient-primary rounded-full h-10 w-10 p-0">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    {/* Anexar */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" disabled={sending} aria-label="Anexar arquivo">
                          <Paperclip className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="top" className="glass-card">
                        <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                          <ImageIcon className="h-4 w-4 mr-2" />Foto
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => docInputRef.current?.click()}>
                          <FileText className="h-4 w-4 mr-2" />Documento
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Emoji picker */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" disabled={sending} aria-label="Emoji">
                          <Smile className="h-5 w-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="start" className="p-0 w-auto border-0 bg-transparent shadow-none">
                        <EmojiPicker
                          onEmojiClick={(d) => insertEmoji(d.emoji)}
                          theme={EmojiTheme.AUTO}
                          width={320}
                          height={380}
                        />
                      </PopoverContent>
                    </Popover>

                    {/* Figurinhas favoritas */}
                    <FavoriteStickers
                      disabled={sending}
                      onSend={(file) => sendMedia(file, "sticker")}
                    />

                    <input
                      ref={imageInputRef} type="file" accept="image/*"
                      className="hidden" onChange={onPickImage}
                    />
                    <input
                      ref={docInputRef} type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf"
                      className="hidden" onChange={onPickDoc}
                    />

                    <Textarea
                      placeholder="Mensagem"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault(); send();
                        }
                      }}
                      rows={1}
                      className="resize-none rounded-3xl min-h-[40px] max-h-32 py-2.5 px-4 bg-background/60"
                    />

                    {draft.trim() ? (
                      <Button
                        onClick={send}
                        disabled={sending}
                        className="bg-gradient-primary rounded-full h-10 w-10 p-0 shrink-0"
                        aria-label="Enviar"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={startRecording}
                        disabled={sending}
                        className="bg-gradient-primary rounded-full h-10 w-10 p-0 shrink-0"
                        aria-label="Gravar áudio"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
