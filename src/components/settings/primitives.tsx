import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { settingSlug } from "@/components/settings/settings-index";

/**
 * Shared building blocks for the settings dialog tabs — the same
 * surface-panel + row language the sidebar and player card use.
 */

/** Cluster of related rows. No card chrome — settings read as one
 *  flat list, rows separated by hairline dividers only. */
export function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-w060">{children}</div>;
}

export function SettingRow({
  icon: Icon,
  iconClassName,
  title,
  settingId,
  description,
  control,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  /** Stable id the settings search scrolls to; defaults to the title's slug. */
  settingId?: string;
  description?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div
      data-setting={settingId ?? settingSlug(title)}
      className="flex items-center gap-3.5 rounded-[10px] py-4"
    >
      {/* The icon sits on the same resting fill as the switch and the
          segmented track, so a row reads as one family of surfaces. */}
      <div className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-w070 bg-w050">
        <Icon className={cn("size-4 text-t5", iconClassName)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-sm font-semibold leading-none text-t2">
          {title}
        </span>
        {description ? (
          <span className="text-[12.5px] leading-snug text-t7">
            {description}
          </span>
        ) : null}
      </div>
      {control}
    </div>
  );
}

/** Tab pane wrapper. Dividers between top-level blocks continue the
 *  same flat-list rhythm the groups use internally; the tab heading
 *  itself lives in the dialog shell's fixed header row.
 *
 *  The first row keeps its own top padding: the design leaves the list
 *  breathing under the header rule rather than butting against it. */
export function TabPane({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-w060">{children}</div>;
}
