import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ControlsProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onChange: (page: number) => void;
}

/**
 * Definido fora do hook de propósito: quando morava no corpo de usePagination,
 * ganhava identidade nova a cada render do componente hospedeiro, e o React
 * desmontava e remontava toda a subárvore da paginação — perdendo o foco do
 * teclado a cada digitação no filtro.
 */
function PaginationControls({ page, totalPages, pageSize, totalItems, onChange }: ControlsProps) {
  if (totalItems <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-border text-xs"
    >
      <div className="text-muted-foreground" aria-live="polite">
        Mostrando <strong>{from}–{to}</strong> de <strong>{totalItems}</strong>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onChange(Math.max(1, page - 1))}
          className="h-8 w-8"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          size="icon"
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          className="h-8 w-8"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

export function usePagination<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Reset para página 1 sempre que a lista (filtrada) mudar de tamanho
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [items.length, totalPages, page]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  // Elemento pronto, não componente: assim o React reconcilia sempre contra o
  // mesmo tipo (PaginationControls) e nada remonta. Use como {Controls}.
  const Controls = (
    <PaginationControls
      page={page}
      totalPages={totalPages}
      pageSize={pageSize}
      totalItems={items.length}
      onChange={setPage}
    />
  );

  return { page, setPage, totalPages, paged, Controls };
}
