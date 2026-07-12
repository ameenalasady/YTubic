import { useState } from "react";
import { GripVerticalIcon, HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useHomeSectionsStore } from "@/lib/store/home-sections";
import { cn } from "@/lib/utils";

/**
 * Drag-to-reorder list for the Home page's shelves (Listen again, Quick
 * picks, etc.). The home feed carries no stable id per shelf — only a
 * title string — so `useHomeSectionsStore` keys the saved order on
 * that (see the store for the full rationale). Reordering here flips
 * `customized` on, which makes the Home route eager-load every page
 * before rendering so a section ranked first always appears first,
 * even if the API happened to place it on a later page.
 */
export function HomeTab() {
  const order = useHomeSectionsStore((s) => s.order);
  const reorder = useHomeSectionsStore((s) => s.reorder);
  const resetToDefault = useHomeSectionsStore((s) => s.resetToDefault);
  const customized = useHomeSectionsStore((s) => s.customized);

  // Same native-HTML5-drag pattern as the queue panel's reorderable
  // list (`queue-panel.tsx`) — no drag-and-drop library in this repo.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <TabPane tightTop>
      <Group>
        <SettingRow
          icon={HomeIcon}
          title="Section order"
          description="Drag to reorder the sections shown on the Home page."
          control={
            customized ? (
              <Button variant="ghost" size="sm" onClick={resetToDefault}>
                Reset
              </Button>
            ) : undefined
          }
        />
      </Group>
      <div className="flex flex-col gap-0.5 pt-4">
        {order.map((title, i) => (
          <HomeSectionRow
            key={title}
            title={title}
            isDragging={dragFrom === i}
            isDropTarget={dragOver === i && dragFrom !== i}
            onDragStart={() => setDragFrom(i)}
            onDragOver={() => {
              if (dragFrom === null) return;
              setDragOver(i);
            }}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== i) {
                // Same "insert before the hovered row" math as the queue
                // panel: splicing the dragged item out first shifts a
                // downward target's index down by one.
                const to = dragFrom < i ? i - 1 : i;
                reorder(dragFrom, to);
              }
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
          />
        ))}
      </div>
    </TabPane>
  );
}

function HomeSectionRow({
  title,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  title: string;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Some browsers refuse to start a drag without a dataTransfer
        // payload.
        e.dataTransfer.setData("text/plain", title);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-2 select-none",
        "cursor-grab active:cursor-grabbing hover:bg-accent/60",
        isDragging && "opacity-40",
        isDropTarget &&
          "before:pointer-events-none before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-brand",
      )}
    >
      <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground/60" />
      <span className="truncate text-sm">{title}</span>
    </div>
  );
}
