import type { jsPDF } from "jspdf";
import { toast } from "sonner";

/**
 * Salva o PDF e avisa quando não dá.
 *
 * doc.save() monta o arquivo e dispara o download sozinho — e quando o
 * navegador recusa esse download (bloqueio de arquivo automático, aba sem
 * permissão, WebView do celular) ele não reclama: o PDF fica pronto na memória
 * e some. Era o que acontecia no Relatório de Contas a Receber — 2,2 MB
 * gerados a cada clique, nenhum arquivo na pasta e nenhum erro na tela.
 *
 * Aqui o arquivo é montado uma vez e salvo pelo caminho normal. Se nada for
 * baixado, abre o PDF numa aba, que é o caminho que o bloqueio permite; e se
 * nem isso passar, a pessoa fica sabendo em vez de clicar de novo achando que
 * o sistema travou.
 */
export function salvarPdf(doc: jsPDF, nomeArquivo: string): void {
  let blob: Blob;
  try {
    blob = doc.output("blob");
  } catch (e) {
    console.error("[pdf] não consegui montar o arquivo:", e);
    toast.error("Não consegui montar o PDF. Tente de novo ou filtre menos linhas.");
    return;
  }

  const url = URL.createObjectURL(blob);
  // A liberação espera o download começar; soltar na hora cancela o arquivo.
  const soltar = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`PDF gerado (${(blob.size / 1024 / 1024).toFixed(1)} MB). Confira os downloads.`, {
      action: { label: "Abrir numa aba", onClick: () => window.open(url, "_blank", "noopener") },
    });
    soltar();
    return;
  } catch (e) {
    console.error("[pdf] download recusado pelo navegador:", e);
  }

  const aba = window.open(url, "_blank", "noopener");
  if (aba) {
    toast.success("PDF aberto numa aba nova — salve por lá.");
  } else {
    toast.error("O navegador bloqueou o arquivo. Libere downloads ou pop-ups para este site e tente de novo.");
  }
  soltar();
}
