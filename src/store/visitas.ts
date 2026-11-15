import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Contador de visitas da vitrine.
 *
 * O que vai para o banco: o caminho da página (sem a query, que pode levar a
 * busca da cliente), o domínio de onde ela veio, se é celular, e uma chave
 * aleatória da visita. Essa chave fica em sessionStorage — some quando a aba
 * fecha —, então dá para contar quantas visitas houve num dia sem seguir
 * ninguém de um dia para o outro. Sem IP, sem cookie, sem banner de consentimento.
 *
 * Falha de rede aqui nunca atrapalha a cliente: o erro é engolido de propósito.
 */

const CHAVE = "jmk-visita";

function chaveDaVisita(): string | null {
  try {
    const guardada = sessionStorage.getItem(CHAVE);
    if (guardada) return guardada;
    const nova = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem(CHAVE, nova);
    return nova;
  } catch {
    // Navegador com armazenamento bloqueado (aba anônima restrita, por exemplo).
    return null;
  }
}

/** Só o domínio de quem indicou, e nunca o próprio site. */
function hostDeOrigem(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).hostname;
    return host && host !== window.location.hostname ? host : null;
  } catch {
    return null;
  }
}

export async function registrarVisita(path: string): Promise<void> {
  const visita = chaveDaVisita();
  if (!visita) return;
  try {
    await supabase.rpc("store_registrar_visita", {
      p_visit_key: visita,
      p_path: path,
      p_referrer_host: hostDeOrigem(),
      p_is_mobile: window.matchMedia("(max-width: 768px)").matches,
    });
  } catch {
    /* contador nunca pode quebrar a loja */
  }
}

/** Registra a página atual e cada troca de página dentro da loja. */
export function useContadorDeVisitas(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    // Robô que não executa JavaScript já não chega aqui. Este teste pega os
    // automatizados mais óbvios, que rodam a página de verdade.
    if (navigator.webdriver) return;
    void registrarVisita(pathname);
  }, [pathname]);
}
