import { useEffect, useState } from "react";
import { PageHeader, GlassCard } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Smartphone, Share, PlusSquare, Download, MessageCircle, Apple, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Install() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS
      (window.navigator as any).standalone === true;
    setInstalled(isStandalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      toast.success("App instalado! Procure o ícone na tela inicial.");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  const install = async () => {
    if (!deferred) {
      toast.info("Use o menu do navegador: 'Adicionar à tela inicial'.");
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      toast.success("Instalando...");
    }
    setDeferred(null);
  };

  return (
    <div>
      <PageHeader
        title="Instalar no celular"
        description="Tenha as Conversas como um app na tela inicial"
      />

      <div className="grid gap-4 max-w-2xl">
        <GlassCard>
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-2xl overflow-hidden bg-gradient-primary shrink-0 shadow-glow">
              <img src="/icon-192.png" alt="Ícone JMK Conversas" className="h-full w-full object-cover" width={64} height={64} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">JMK Conversas</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Abre direto na aba de Conversas, em tela cheia, sem barra de navegador. Notificações de WhatsApp e atendimento mais rápido no celular.
              </p>
            </div>
          </div>

          {installed ? (
            <div className="mt-4 p-3 rounded-xl bg-success/10 text-success flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              App já está instalado neste dispositivo.
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={install}
                className="bg-gradient-primary text-primary-foreground rounded-xl shadow-glow"
                disabled={isIOS && !deferred}
              >
                <Download className="h-4 w-4 mr-1" />
                {deferred ? "Instalar agora" : "Adicionar à tela inicial"}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => navigate("/conversas")}>
                <MessageCircle className="h-4 w-4 mr-1" /> Ir para Conversas
              </Button>
            </div>
          )}
        </GlassCard>

        {/* iOS */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-3">
            <Apple className="h-5 w-5" />
            <h3 className="font-semibold">iPhone / iPad (Safari)</h3>
            {isIOS && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">seu dispositivo</span>}
          </div>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Abra este link no <strong>Safari</strong> (não funciona no Chrome do iPhone).</li>
            <li>Toque no botão <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Compartilhar</strong> (na barra inferior).</li>
            <li>Role e toque em <PlusSquare className="inline h-4 w-4 align-text-bottom" /> <strong>Adicionar à Tela de Início</strong>.</li>
            <li>Confirme em <strong>Adicionar</strong>. Pronto — o ícone aparece na home.</li>
          </ol>
        </GlassCard>

        {/* Android */}
        <GlassCard>
          <div className="flex items-center gap-2 mb-3">
            <Smartphone className="h-5 w-5" />
            <h3 className="font-semibold">Android (Chrome)</h3>
            {isAndroid && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">seu dispositivo</span>}
          </div>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Toque no botão <strong>"Instalar agora"</strong> acima — se aparecer, é um clique só.</li>
            <li>Se não aparecer, abra o menu do Chrome (⋮) e escolha <strong>"Instalar app"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</li>
            <li>Confirme. O app aparece na sua gaveta de apps e na tela inicial.</li>
          </ol>
        </GlassCard>

        <GlassCard>
          <h3 className="font-semibold mb-2 text-sm">Dica</h3>
          <p className="text-xs text-muted-foreground">
            A instalação só funciona na versão publicada do app (HTTPS). Se você abriu pelo editor do Lovable, abra o link publicado pelo celular antes de instalar.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
