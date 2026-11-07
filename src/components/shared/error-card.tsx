import { IconAlertCircle } from "@tabler/icons-react";

/**
 * The inline "couldn't load" card every page shows when its main query
 * fails. One component so the pages can't drift apart in markup, and so
 * every one of them offers the same Retry link when it can refetch.
 */
export function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <IconAlertCircle className="size-5 shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{message}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 w-fit cursor-pointer text-brand hover:underline"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
