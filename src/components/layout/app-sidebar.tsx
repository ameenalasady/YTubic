import { useEffect, useRef, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  HomeIcon,
  CompassIcon,
  SearchIcon,
  LibraryIcon,
  SettingsIcon,
  HeartIcon,
  ListMusicIcon,
  PinIcon,
  PinOffIcon,
  EyeOffIcon,
  UserPlusIcon,
  UserCogIcon,
  UsersRoundIcon,
  CreditCardIcon,
  LogInIcon,
  LogOutIcon,
  ExternalLinkIcon,
  CheckIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useHidden,
  usePinned,
  usePinnedPlaylistsStore,
} from "@/lib/store/pinned-playlists";
import { fetchLibraryPlaylists } from "@/lib/innertube/library";
import { pickThumbnail } from "@/components/shared/thumbnail";
import { openChannelPicker } from "@/lib/store/channel-picker";
import { openSettings } from "@/lib/store/settings-dialog";
import { UpdateBanner } from "@/components/layout/update-banner";
import { fetchAccountInfo } from "@/lib/innertube/account";
import { resetInnertube } from "@/lib/innertube/client";
import { usePremiumStore } from "@/lib/store/premium";
import {
  removeAccount,
  switchAccount,
  useAccounts,
  type AccountSummary,
} from "@/lib/store/accounts";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/explore", label: "Explore", icon: CompassIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/library", label: "Library", icon: LibraryIcon },
] as const;

// Liked Songs is the YTM magic playlist — browseId `VLLM` (wraps
// playlistId "LM"). Always present, always first in the playlists
// section, not user-removable.
const LIKED_ID = "VLLM";

const MENU_BTN_CLS = "group-data-[collapsible=icon]:mx-auto";

export function AppSidebar() {
  const { location } = useRouterState();
  const pinned = usePinned();
  const hidden = useHidden();

  const loggedIn = useQuery({
    queryKey: ["auth-logged-in"],
    queryFn: () => invoke<boolean>("is_logged_in"),
    staleTime: 30_000,
  });

  // The user's saved/created playlists from their YT Music library.
  // Shares the `["library", "playlists"]` query key (and cache) with the
  // Library page so opening either warms the other. Signed-in only —
  // without cookies the browse redirects to a generic page.
  const libraryPlaylists = useQuery({
    queryKey: ["library", "playlists"],
    queryFn: fetchLibraryPlaylists,
    enabled: loggedIn.data === true,
    staleTime: 5 * 60_000,
  });

  const isOn = (to: string) => location.pathname === to;
  const isPlaylistOn = (id: string) =>
    location.pathname === `/playlist/${id}`;

  // Flatten the library shelves and drop entries already shown above:
  // Liked Songs (its own hardcoded row, id `VLLM`/`LM`) and anything the
  // user has explicitly pinned (rendered with an unpin menu).
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const hiddenIds = new Set(hidden);
  const libraryItems = (libraryPlaylists.data ?? [])
    .flatMap((s) => s.items)
    .filter(
      (it) =>
        it.id !== LIKED_ID &&
        it.id.replace(/^VL/, "") !== "LM" &&
        !pinnedIds.has(it.id) &&
        !hiddenIds.has(it.id),
    );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Ramp a soft top/bottom fade on the list from its scroll position so
  // rows dissolve into transparency at each edge instead of being cut by
  // a hard line. An edge with nothing beyond it — the top at rest, the
  // bottom when fully scrolled, or a list too short to scroll — stays
  // crisp. Vertical mirror of the carousels' `shelf-edge-fade`.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const FADE_RAMP = 16;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const update = () => {
      const distTop = el.scrollTop;
      const distBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      el.style.setProperty("--fade-t", clamp(1 - distTop / FADE_RAMP).toFixed(3));
      el.style.setProperty(
        "--fade-b",
        clamp(1 - distBottom / FADE_RAMP).toFixed(3),
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Rows load async and grow the scroll height without resizing the
    // container, so watch the inner list too.
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <Sidebar
      variant="floating"
      collapsible="icon"
      className="px-2 pb-2 pt-0 duration-300 ease-out [&>[data-slot=sidebar-inner]]:rounded-[10px] [&>[data-slot=sidebar-inner]]:bg-surface [&>[data-slot=sidebar-inner]]:shadow-none"
    >
      {/* Branding (logo + wordmark) intentionally omitted on this fork.
       *  A slim empty header stays as top spacing so the first nav group
       *  doesn't butt against the sidebar's rounded top edge. */}
      <SidebarHeader className="pt-3" />

      {/* The content column itself doesn't scroll: Browse stays pinned
          (shrink-0) and only the Playlists list scrolls, so the top nav
          never slides out of view when the library is long. */}
      <SidebarContent className="gap-0 overflow-hidden">
        <SidebarGroup className="shrink-0 py-1">
          <SidebarGroupLabel>Browse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={isOn(to)}
                    tooltip={label}
                    className={MENU_BTN_CLS}
                  >
                    <Link to={to}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* `pe-0` drops the group's right padding so the scroll box
            reaches the panel edge — `sidebar-list-scroll` (index.css)
            reserves a stable 8px scrollbar gutter there, so the rows
            keep a constant right inset (aligned with Browse) whether or
            not a scrollbar shows. Collapsed restores `pe-2` for a
            symmetric, centered rail. */}
        <SidebarGroup className="flex min-h-0 flex-1 flex-col py-1 pe-0 group-data-[collapsible=icon]:pe-2">
          <SidebarGroupLabel>Playlists</SidebarGroupLabel>
          {/* The scroll lives here, not on SidebarContent, so the label
              above stays put and only the playlist rows move.
              `app-scroll` is the same thin scrollbar the main content
              and carousels use. */}
          <SidebarGroupContent
            ref={scrollRef}
            className="sidebar-list-fade sidebar-list-scroll app-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isPlaylistOn(LIKED_ID)}
                  tooltip="Liked songs"
                  className={MENU_BTN_CLS}
                >
                  <Link to="/playlist/$id" params={{ id: LIKED_ID }}>
                    <HeartIcon className="fill-rose-500 text-rose-500" />
                    <span>Liked songs</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {pinned.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <PlaylistRowMenu
                    id={p.id}
                    title={p.title}
                    thumbnailUrl={p.thumbnailUrl}
                    pinned
                  >
                    <SidebarMenuButton
                      asChild
                      isActive={isPlaylistOn(p.id)}
                      tooltip={p.title}
                      className={MENU_BTN_CLS}
                    >
                      <Link to="/playlist/$id" params={{ id: p.id }}>
                        {p.thumbnailUrl ? (
                          <img
                            src={p.thumbnailUrl}
                            alt=""
                            className="size-4 shrink-0 rounded-sm object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ListMusicIcon />
                        )}
                        <span>{p.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </PlaylistRowMenu>
                </SidebarMenuItem>
              ))}

              {libraryItems.map((it) => {
                const thumbnailUrl = pickThumbnail(it.thumbnails, 32);
                return (
                  <SidebarMenuItem key={it.id}>
                    <PlaylistRowMenu
                      id={it.id}
                      title={it.title}
                      thumbnailUrl={
                        it.thumbnails[it.thumbnails.length - 1]?.url
                      }
                      pinned={false}
                    >
                      <SidebarMenuButton
                        asChild
                        isActive={isPlaylistOn(it.id)}
                        tooltip={it.title}
                        className={MENU_BTN_CLS}
                      >
                        <Link to="/playlist/$id" params={{ id: it.id }}>
                          {thumbnailUrl ? (
                            <img
                              src={thumbnailUrl}
                              alt=""
                              className="size-4 shrink-0 rounded-sm object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <ListMusicIcon />
                          )}
                          <span>{it.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </PlaylistRowMenu>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UpdateBanner />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              className={MENU_BTN_CLS}
              onClick={() => openSettings()}
            >
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UserProfile />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Right-click menu for a sidebar playlist row: pin/unpin plus hide. A
 * playlist that's currently hidden never reaches this list (filtered out
 * in AppSidebar), so there's no "unhide" branch here — that lives on the
 * Library card instead (see PlaylistPinContextMenu in shelf-card.tsx),
 * which is where a hidden playlist is still visible and reversible.
 */
function PlaylistRowMenu({
  id,
  title,
  thumbnailUrl,
  pinned,
  children,
}: {
  id: string;
  title: string;
  thumbnailUrl?: string;
  pinned: boolean;
  children: ReactNode;
}) {
  const pin = usePinnedPlaylistsStore((s) => s.pin);
  const unpin = usePinnedPlaylistsStore((s) => s.unpin);
  const hide = usePinnedPlaylistsStore((s) => s.hide);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {pinned ? (
          <ContextMenuItem onSelect={() => unpin(id)}>
            <PinOffIcon />
            Unpin from sidebar
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => pin({ id, title, thumbnailUrl })}>
            <PinIcon />
            Pin to sidebar
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => hide(id)}>
          <EyeOffIcon />
          Hide from sidebar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Where the YT Music web client sends users to manage their Music
// Premium subscription. Kept here (not in a shared constants module)
// because it's the only place that links out to it.
const MANAGE_GOOGLE_URL = "https://myaccount.google.com/";
const MANAGE_SUBSCRIPTION_URL =
  "https://music.youtube.com/paid_memberships";

/**
 * The logged-out footer CTA: a full-width primary (brand red) button.
 * Collapses to a red icon button with a tooltip in icon mode. Runs the
 * same `start_login` flow as "Add another account".
 */
function SidebarSignInButton() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Button
          title="Sign in"
          onClick={() => {
            invoke("start_login").catch((e) =>
              toast.error(`Sign-in failed: ${String(e)}`),
            );
          }}
          className="h-9 w-full gap-2 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
        >
          <LogInIcon />
          <span className="group-data-[collapsible=icon]:hidden">Sign in</span>
        </Button>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserProfile() {
  const loggedIn = useQuery({
    queryKey: ["auth-logged-in"],
    queryFn: () => invoke<boolean>("is_logged_in"),
    staleTime: 30_000,
  });
  const account = useQuery({
    queryKey: ["account-info"],
    queryFn: () => fetchAccountInfo(),
    enabled: !!loggedIn.data,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const accounts = useAccounts();
  const premiumStatus = usePremiumStore((s) => s.status);

  const allAccounts = accounts.data ?? [];
  const activeAccount = allAccounts.find((a) => a.isActive) ?? allAccounts[0];

  // Auth check still resolving: render nothing to avoid a flash.
  if (loggedIn.isLoading) return null;

  // No live profile: signed out, or `is_logged_in` reports a session (a
  // SAPISID cookie exists) whose `/account_menu` never loads (expired
  // session). With one stored account or none, the primary sign-in
  // button is the way back in; a re-login merges into the existing row
  // via identity dedup, so no duplicate appears. With several stored
  // accounts, collapsing to a sign-in button would strand the user away
  // from the healthy ones (no way to switch or to sign the broken one
  // out), so keep the menu and render it from the stored meta instead.
  if (!account.data) {
    // Give a genuine first paint a moment before falling back.
    if (loggedIn.data === true && account.isLoading) return null;
    if (allAccounts.length < 2) return <SidebarSignInButton />;
  }

  const live = account.data;
  const name =
    live?.name ||
    activeAccount?.channelName ||
    activeAccount?.name ||
    activeAccount?.email ||
    "Account";
  const email = live?.email ?? activeAccount?.email ?? "";
  const photoUrl =
    live?.photoUrl ??
    activeAccount?.channelPhotoUrl ??
    activeAccount?.photoUrl ??
    undefined;
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  const isPremium = premiumStatus === "premium";
  const tierLabel = isPremium ? "Premium" : "Free";

  const signOut = async () => {
    if (!activeAccount) {
      // Defensive: should never happen because the trigger only
      // renders when loggedIn is true, but if accounts.data hasn't
      // landed yet we fall back to nuking all auth state.
      try {
        await invoke("clear_cookies");
        resetInnertube();
        toast.success("Signed out");
      } catch (e) {
        toast.error(`Sign out failed: ${String(e)}`);
      }
      return;
    }
    try {
      await removeAccount(activeAccount.id);
      // The Rust `remove_account` either promotes the next account to
      // active (multi-account case) or drops the user to signed-out
      // (last-account case). Either way `accounts-changed` fires and
      // the listener takes care of query invalidation + client reset.
      toast.success("Signed out");
    } catch (e) {
      toast.error(`Sign out failed: ${String(e)}`);
    }
  };

  // Opens an isolated Google sign-in window so the user can pick a
  // *different* identity — the new account is appended to the list
  // rather than replacing the current one. Rust's `start_login`
  // emits `accounts-changed` on success which invalidates the list
  // query for us.
  const addAccount = async () => {
    try {
      await invoke("start_login");
    } catch (e) {
      toast.error(`Sign-in failed: ${String(e)}`);
    }
  };

  const onSwitch = (target: AccountSummary) => async () => {
    if (target.isActive) return;
    try {
      await switchAccount(target.id);
      // `accounts-changed` listener handles all invalidation — no need
      // to do it manually here.
    } catch (e) {
      toast.error(`Switch failed: ${String(e)}`);
    }
  };

  const openExternal = (url: string) => () => {
    openUrl(url).catch((e) => toast.error(String(e)));
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={email ? `${name} (${email})` : name}
              className={MENU_BTN_CLS}
            >
              <Avatar className="size-4 shrink-0">
                {photoUrl ? <AvatarImage src={photoUrl} alt={name} /> : null}
                <AvatarFallback className="text-[9px] leading-none">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{name}</span>
              {/* The tier badge is a claim about the live session; with
                  only stored meta (dead session fallback) it would say
                  "Free" about an account we can't actually see. */}
              {live ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "ms-auto h-4 px-1.5 text-[10px] font-semibold uppercase tracking-wide",
                    "group-data-[collapsible=icon]:hidden",
                    isPremium
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  {tierLabel}
                </Badge>
              ) : null}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="min-w-64"
          >
            {email ? (
              <>
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {allAccounts.length ? (
              <>
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Accounts
                </DropdownMenuLabel>
                {allAccounts.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={onSwitch(a)}
                    // Highlight the active row so the picker reads as
                    // "you are signed in as this one". `data-active`
                    // style mirrors what TanStack Router does on
                    // sidebar links — same visual language across the
                    // app. `focus:bg-accent` from the base item style
                    // still wins on hover, which is what we want.
                    data-active={a.isActive ? "true" : undefined}
                    className={cn(
                      "data-[active=true]:bg-accent/60 data-[active=true]:text-accent-foreground",
                    )}
                  >
                    <Avatar className="size-4 shrink-0">
                      {a.photoUrl ? (
                        <AvatarImage src={a.photoUrl} alt={a.name} />
                      ) : null}
                      <AvatarFallback className="text-[9px] leading-none">
                        {(a.name || a.email || "?")
                          .trim()
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">
                        {a.name || a.email || "Unknown account"}
                      </span>
                      {a.email && a.name ? (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {a.email}
                        </span>
                      ) : null}
                    </div>
                    {a.isActive ? (
                      <CheckIcon className="ms-auto text-emerald-500" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => openChannelPicker()}>
              <UsersRoundIcon />
              Switch channel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addAccount}>
              <UserPlusIcon />
              Add another account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openExternal(MANAGE_GOOGLE_URL)}>
              <UserCogIcon />
              Manage Google Account
              <ExternalLinkIcon className="ms-auto" />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={openExternal(MANAGE_SUBSCRIPTION_URL)}
            >
              <CreditCardIcon />
              Manage subscription
              <ExternalLinkIcon className="ms-auto" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={signOut}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
