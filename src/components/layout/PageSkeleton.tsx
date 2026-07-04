import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div className="p-6 space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-3 mt-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export default PageSkeleton;
