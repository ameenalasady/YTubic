import type { ReactNode } from "react";
import { IconChevronDown, IconLayoutGrid, IconList } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CardSize, ViewLayout } from "@/lib/store/videos-view";

/** Cards per row at full width, and the narrowest a card may get before the
 *  row holds fewer (so a small window never squeezes 7 cards into slivers). */
export const CARD_SIZES: Record<
  CardSize,
  { label: string; perRow: number; minRem: number }
> = {
  small: { label: "Small", perRow: 7, minRem: 8 },
  medium: { label: "Medium", perRow: 5, minRem: 11 },
  big: { label: "Big", perRow: 3, minRem: 15 },
};

const GAP_REM = 0.5; // gap-2

/** `grid-template-columns` giving `perRow` columns, or fewer once the
 *  container is too narrow for them to stay `minRem` wide. The 0.5px keeps
 *  rounding from ever costing a column at exactly full width. */
export function cardColumns(size: CardSize): string {
  const { perRow, minRem } = CARD_SIZES[size];
  const share = `calc((100% - ${(perRow - 1) * GAP_REM}rem) / ${perRow} - 0.5px)`;
  return `repeat(auto-fill, minmax(max(${minRem}rem, ${share}), 1fr))`;
}

/** Thumbnail cards in rows of 7 / 5 / 3, depending on the chosen size. */
export function CardGrid({
  size,
  children,
}: {
  size: CardSize;
  children: ReactNode;
}) {
  return (
    <div
      className="grid w-full gap-2"
      style={{ gridTemplateColumns: cardColumns(size) }}
    >
      {children}
    </div>
  );
}

/**
 * The "View" dropdown that sits next to the sort button: list or cards, and
 * how big the cards are. Picking a card size also switches to cards, since
 * that is clearly what the click was for.
 */
export function ViewMenu({
  layout,
  size,
  onLayout,
  onSize,
}: {
  layout: ViewLayout;
  size: CardSize;
  onLayout: (l: ViewLayout) => void;
  onSize: (s: CardSize) => void;
}) {
  const Icon = layout === "cards" ? IconLayoutGrid : IconList;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Change view">
          <Icon />
          {layout === "cards" ? "Cards" : "List"}
          <IconChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={layout}
          onValueChange={(v) => onLayout(v as ViewLayout)}
        >
          <DropdownMenuRadioItem value="list">
            <IconList />
            List
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="cards">
            <IconLayoutGrid />
            Cards
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Card size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={layout === "cards" ? size : ""}
          onValueChange={(v) => onSize(v as CardSize)}
        >
          {(Object.keys(CARD_SIZES) as CardSize[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {CARD_SIZES[s].label}
              <span className="ms-1 text-xs text-muted-foreground">
                {CARD_SIZES[s].perRow} per row
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
