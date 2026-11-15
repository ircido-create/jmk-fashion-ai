import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BarChart3, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/layout/PageHeader";

/**
 * Movimento da loja virtual. Conta só quem entra na vitrine — o administrativo
 * não é medido, para o número mostrar cliente e não equipe.
 *
 * "Visitas" é gente que entrou (uma visita = uma passagem pela loja, da entrada
 * até fechar a aba). "Páginas" é quantas telas essa gente olhou no total.
 */

export interface DiaDeVisita {
  dia: string;
  visitas: number;
  paginas: number;
  celular: number;
}

function useVisitasPorDia(dias: number) {
  const [linhas, setLinhas] = useState<DiaDeVisita[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase.rpc("store_visitas_por_dia", { p_dias: dias }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setErro(error.message);
      else setLinhas((data ?? []) as DiaDeVisita[]);
    });
    return () => {
      vivo = false;
    };
  }, [dias]);

  return { linhas, erro };
}

const chaveDoDia = (d: Date) => format(d, "yyyy-MM-dd");

function destaques(linhas: DiaDeVisita[] | null, janela: number) {
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  const doDia = (d: Date) => linhas?.find((x) => x.dia === chaveDoDia(d))?.visitas;
  const total = linhas ? linhas.reduce((t, d) => t + Number(d.visitas ?? 0), 0) : undefined;
  return [
    { rotulo: "Hoje", valor: linhas ? doDia(hoje) ?? 0 : undefined },
    { rotulo: "Ontem", valor: linhas ? doDia(ontem) ?? 0 : undefined },
    { rotulo: `${janela} dias`, valor: total },
  ];
}

/** Três números, para o painel inicial. */
export function VisitasResumo() {
  const { linhas, erro } = useVisitasPorDia(7);
  if (erro) return null; // no painel, um contador com problema não atrapalha o resto

  return (
    <GlassCard className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-lg inline-flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
          Visitas da loja
        </h3>
        <Link to="/pedidos-loja" className="text-xs text-primary hover:underline">
          Ver dia a dia
        </Link>
      </div>

      {!linhas ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary mt-4" aria-label="Carregando" />
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {destaques(linhas, 7).map((d) => (
            <div key={d.rotulo} className="rounded-xl border border-border/60 p-3 text-center">
              <p className="text-xs text-muted-foreground">{d.rotulo}</p>
              <p className="text-xl md:text-2xl font-display font-bold mt-1">{d.valor ?? 0}</p>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

/** Números e tabela dia a dia, para a tela de Pedidos da Loja. */
export function VisitasDetalhe() {
  const { linhas, erro } = useVisitasPorDia(14);

  return (
    <GlassCard className="mt-8 p-5">
      <h3 className="font-semibold inline-flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
        Visitas da loja
      </h3>
      <p className="text-xs text-muted-foreground mt-1">
        Quem entrou na loja virtual. Não conta você nem a equipe usando o sistema.
      </p>

      {erro ? (
        <p className="text-sm text-destructive mt-4">{erro}</p>
      ) : !linhas ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary mt-4" aria-label="Carregando" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {destaques(linhas, 14).map((d) => (
              <div key={d.rotulo} className="rounded-lg border border-border/60 p-3 text-center">
                <p className="text-xs text-muted-foreground">{d.rotulo}</p>
                <p className="text-2xl font-semibold mt-0.5">{d.valor ?? 0}</p>
              </div>
            ))}
          </div>

          {linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-4">
              Ainda não há visitas registradas.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground text-left">
                    <th className="pb-2 font-medium">Dia</th>
                    <th className="pb-2 font-medium text-right">Visitas</th>
                    <th className="pb-2 font-medium text-right">Páginas</th>
                    <th className="pb-2 font-medium text-right">No celular</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((d) => (
                    <tr key={d.dia} className="border-t border-border/40">
                      <td className="py-1.5">
                        {format(new Date(`${d.dia}T12:00:00`), "dd/MM (EEE)", { locale: ptBR })}
                      </td>
                      <td className="py-1.5 text-right font-medium">{d.visitas}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{d.paginas}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{d.celular}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
