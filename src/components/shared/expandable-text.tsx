import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CLAMP: Record<number, string> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

type Props = {
  text: string;
  /** Collapsed line count (Tailwind line-clamp). Default 3. */
  lines?: 2 | 3 | 4 | 5 | 6;
  className?: string;
};

/**
 * Clamped multi-line text with a "Read more" toggle. The toggle only
 * shows when the text actually overflows the clamp (measured, so short
 * texts stay clean). Key the component by `text` at the call site so
 * the expanded state resets when the content changes.
 */
export function ExpandableText({ text, lines = 3, className }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-line text-sm text-muted-foreground",
          expanded ? "" : CLAMP[lines],
          className,
        )}
      >
        {text}
      </p>
      {clamped || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
