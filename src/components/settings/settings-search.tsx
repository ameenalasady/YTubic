import { Fragment, type ComponentType, type KeyboardEvent } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";
import {
  MIN_QUERY_LENGTH,
  queryTerms,
  type SettingEntry,
  type SettingMatch,
} from "@/components/settings/settings-index";
import type { SettingsTab } from "@/lib/store/settings-dialog";

/** Search box for the top of the settings rail. */
export function SettingsSearchField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Enter: open the best result. */
  onSubmit: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    } else if (e.key === "Escape" && value) {
      // First Esc clears the search; only an empty box lets it close the dialog.
      e.preventDefault();
      e.stopPropagation();
      onChange("");
    }
  };
  return (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-t7" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search settings"
        aria-label="Search settings"
        spellCheck={false}
        autoComplete="off"
        className="h-8 w-full rounded-[10px] border border-w070 bg-w050 pl-8 pr-7 text-[13px] text-t2 outline-none transition-colors duration-[140ms] placeholder:text-t8 focus:border-w120 focus:bg-w070"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-t7 transition-colors hover:bg-w080 hover:text-t2"
        >
          <IconX className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with every occurrence of a search term picked out. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  const lower = new Set(terms);
  return (
    <>
      {text.split(re).map((part, i) =>
        lower.has(part.toLowerCase()) ? (
          <mark
            key={i}
            className="rounded-[3px] bg-[rgba(var(--acc1rgb),0.22)] px-px text-inherit"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The right-hand pane while a search is active. */
export function SettingsSearchResults({
  query,
  matches,
  tabs,
  onPick,
}: {
  query: string;
  matches: SettingMatch[];
  tabs: {
    id: SettingsTab;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
  onPick: (entry: SettingEntry) => void;
}) {
  const terms = queryTerms(query);

  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
        <span className="text-sm font-semibold text-t3">No settings found</span>
        <span className="text-[12.5px] text-t7">
          Nothing matches “{query.trim()}”. Try a shorter word, like “fade” or
          “font”.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-w060">
      {matches.map(({ entry }) => {
        const tab = tabs.find((t) => t.id === entry.tab);
        const Icon = tab?.icon;
        return (
          <button
            key={`${entry.tab}:${entry.title}`}
            type="button"
            onClick={() => onPick(entry)}
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-lg py-4 text-left transition-colors duration-[140ms] hover:bg-w030"
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-w070 bg-w050">
              {Icon ? <Icon className="size-4 text-t5" /> : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-sm font-semibold leading-none text-t2">
                <Highlight text={entry.title} terms={terms} />
              </span>
              <span className="line-clamp-2 text-[12.5px] leading-snug text-t7">
                <Highlight text={entry.description} terms={terms} />
              </span>
            </div>
            <span className="shrink-0 rounded-[7px] border border-w070 bg-w050 px-2 py-1 text-[11.5px] font-medium text-t6">
              {tab?.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { MIN_QUERY_LENGTH };
