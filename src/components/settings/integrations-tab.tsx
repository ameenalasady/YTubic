import { useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  DiscAlbumIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  FilterIcon,
  HeartIcon,
  ImageIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  MessageCircleIcon,
  Mic2Icon,
  Music2Icon,
  MousePointerClickIcon,
  RadioIcon,
  TimerIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useLastfmStore, isLastfmLinked } from "@/lib/store/lastfm";
import {
  authorizeUrl,
  getSession,
  getToken,
  getUserInfo,
} from "@/lib/lastfm/api";
import { useDiscordStore, isDiscordConfigured } from "@/lib/store/discord";
import { DiscordIcon, LastfmIcon } from "@/components/shared/brand-icons";

type IntegrationId = "lastfm" | "discord";

/**
 * List → detail navigation: the tab opens on a flat list of available
 * integrations (name + live status), and picking one drills into its
 * own submenu with a back row. Keeps each integration's settings from
 * cluttering a single long scroll as more integrations are added.
 */
export function IntegrationsTab() {
  const [active, setActive] = useState<IntegrationId | null>(null);

  if (active === "lastfm") {
    return (
      <TabPane tightTop>
        <BackRow label="Last.fm" onBack={() => setActive(null)} />
        <LastfmGroup />
      </TabPane>
    );
  }
  if (active === "discord") {
    return (
      <TabPane tightTop>
        <BackRow label="Discord Rich Presence" onBack={() => setActive(null)} />
        <DiscordGroup />
      </TabPane>
    );
  }

  return (
    <TabPane tightTop>
      <IntegrationListRow
        icon={Music2Icon}
        title="Last.fm"
        status={<LastfmStatusBadge />}
        onClick={() => setActive("lastfm")}
      />
      <IntegrationListRow
        icon={MessageCircleIcon}
        title="Discord Rich Presence"
        status={<DiscordStatusBadge />}
        onClick={() => setActive("discord")}
      />
    </TabPane>
  );
}

/** Back-navigation row atop a drilled-in integration's settings. Mirrors
 *  the SettingRow row-height/padding language so the submenu reads as a
 *  continuation of the same flat list, not a different surface. */
function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-2 py-4 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </button>
  );
}

/** Clickable summary row for the integrations list — same visual shape
 *  as SettingRow (icon tile + title) with a status control and chevron
 *  standing in for SettingRow's `control` slot. */
function IntegrationListRow({
  icon: Icon,
  title,
  status,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  status: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <SettingRow
        icon={Icon}
        title={title}
        control={
          <div className="flex shrink-0 items-center gap-2">
            {status}
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </div>
        }
      />
    </button>
  );
}

function LastfmStatusBadge() {
  const { apiKey, apiSecret, sessionKey, username, avatarUrl } =
    useLastfmStore();
  const linked = isLastfmLinked({ apiKey, apiSecret, sessionKey });
  return linked ? (
    <div className="flex items-center gap-1.5">
      {avatarUrl ? (
        <Avatar size="sm">
          <AvatarImage src={avatarUrl} alt="" />
          <AvatarFallback>{username?.[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
      ) : null}
      <Badge
        variant="secondary"
        className="bg-rose-500/15 text-rose-600 dark:text-rose-400"
      >
        {username ? `@${username}` : "Connected"}
      </Badge>
    </div>
  ) : (
    <Badge variant="outline">Not connected</Badge>
  );
}

function DiscordStatusBadge() {
  const { enabled, applicationId } = useDiscordStore();
  const configured = isDiscordConfigured({ enabled, applicationId });
  return (
    <Badge
      variant={enabled ? "secondary" : "outline"}
      className={
        enabled && configured
          ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
          : undefined
      }
    >
      {!enabled ? "Disabled" : configured ? "Enabled" : "Needs Client ID"}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Last.fm                                                             */
/* ------------------------------------------------------------------ */

const LASTFM_API_ACCOUNT_URL = "https://www.last.fm/api/account/create";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function LastfmGroup() {
  const {
    apiKey,
    apiSecret,
    sessionKey,
    username,
    avatarUrl,
    scrobblingEnabled,
    loveSyncEnabled,
    setCredentials,
    setSession,
    setAvatarUrl,
    setScrobblingEnabled,
    setLoveSyncEnabled,
    disconnect,
  } = useLastfmStore();
  const linked = isLastfmLinked({ apiKey, apiSecret, sessionKey });

  const [keyInput, setKeyInput] = useState(apiKey);
  const [secretInput, setSecretInput] = useState(apiSecret);
  const [connecting, setConnecting] = useState(false);
  // Lets the user abort the browser-authorization polling loop.
  const cancelledRef = useRef(false);

  // Best-effort avatar fetch: on connect, and lazily for an already-linked
  // account that doesn't have one cached yet (e.g. it linked before this
  // feature existed). Purely cosmetic — failures are silent.
  useEffect(() => {
    if (!linked || !username || avatarUrl) return;
    void getUserInfo({ apiKey, apiSecret }, username)
      .then((info) => setAvatarUrl(info.avatarUrl))
      .catch(() => {});
  }, [linked, username, avatarUrl, apiKey, apiSecret, setAvatarUrl]);

  const connect = async () => {
    const key = keyInput.trim();
    const secret = secretInput.trim();
    if (!key || !secret) {
      toast.error("Enter your Last.fm API key and shared secret first.");
      return;
    }
    setCredentials(key, secret);
    const creds = { apiKey: key, apiSecret: secret };
    setConnecting(true);
    cancelledRef.current = false;
    try {
      const token = await getToken(creds);
      await openUrl(authorizeUrl(key, token));
      toast.info(
        "Authorize YTubic in the browser tab that opened — linking will finish automatically.",
      );
      // Poll for the authorized session. Last.fm returns error 14 ("token
      // not authorized") until the user grants access, and 15 once the
      // token expires (~1 hour, but we give up long before that).
      const startedAt = Date.now();
      while (!cancelledRef.current && Date.now() - startedAt < 150_000) {
        await sleep(3000);
        if (cancelledRef.current) break;
        try {
          const session = await getSession(creds, token);
          setSession(session.key, session.name);
          toast.success(`Connected to Last.fm as ${session.name}`);
          return;
        } catch (e) {
          const code = (e as { code?: number }).code;
          if (code === 14) continue; // not authorized yet — keep waiting
          throw e; // any other error (expired token, network) is terminal
        }
      }
      if (!cancelledRef.current) {
        toast.error("Timed out waiting for Last.fm authorization.");
      }
    } catch (e) {
      toast.error(`Last.fm: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    setConnecting(false);
  };

  const unlink = () => {
    disconnect();
    toast.success("Disconnected from Last.fm");
  };

  return (
    <Group>
      <SettingRow
        icon={Music2Icon}
        title="Last.fm"
        description="Scrobble what you play and share your now-playing status. Uses your own Last.fm API account — nothing is sent anywhere until you connect."
        control={
          linked ? (
            <div className="flex shrink-0 items-center gap-2">
              {avatarUrl ? (
                <Avatar size="sm">
                  <AvatarImage src={avatarUrl} alt="" />
                  <AvatarFallback>
                    {username?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : null}
              <Badge
                variant="secondary"
                className="bg-rose-500/15 text-rose-600 dark:text-rose-400"
              >
                {username ? `@${username}` : "Connected"}
              </Badge>
              <Button variant="outline" size="sm" onClick={unlink}>
                <LogOutIcon />
                Disconnect
              </Button>
            </div>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        }
      />
      {linked ? (
        <>
          <SettingRow
            icon={RadioIcon}
            title="Scrobble tracks"
            description="Send plays and now-playing updates to Last.fm."
            control={
              <Switch
                checked={scrobblingEnabled}
                onCheckedChange={setScrobblingEnabled}
                aria-label="Enable scrobbling"
              />
            }
          />
          <SettingRow
            icon={HeartIcon}
            title="Love liked tracks"
            description="When you like a song in YTubic, also love it on Last.fm."
            control={
              <Switch
                checked={loveSyncEnabled}
                onCheckedChange={setLoveSyncEnabled}
                aria-label="Sync loved tracks"
              />
            }
          />
        </>
      ) : (
        <div className="flex flex-col gap-3 py-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lastfm-key" className="text-sm font-medium">
              API key
            </label>
            <Input
              id="lastfm-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Your Last.fm API key"
              disabled={connecting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lastfm-secret" className="text-sm font-medium">
              Shared secret
            </label>
            <Input
              id="lastfm-secret"
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder="Your Last.fm shared secret"
              disabled={connecting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            onClick={() => openUrl(LASTFM_API_ACCOUNT_URL)}
            className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Create a Last.fm API account
            <ExternalLinkIcon className="size-3" />
          </button>
          <div className="flex items-center gap-2">
            <Button onClick={connect} disabled={connecting}>
              {connecting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LogInIcon />
              )}
              {connecting ? "Waiting for authorization…" : "Connect"}
            </Button>
            {connecting && (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Discord Rich Presence                                               */
/* ------------------------------------------------------------------ */

const DISCORD_DEVELOPER_PORTAL_URL = "https://discord.com/developers/applications";

function DiscordGroup() {
  const {
    enabled,
    applicationId,
    presenceName,
    activityType,
    showTitle,
    showArtist,
    showAlbumArt,
    showAlbumName,
    showTimestamps,
    showButton,
    onlySongs,
    hideWhenPaused,
    setEnabled,
    setApplicationId,
    setPresenceName,
    setActivityType,
    setShowTitle,
    setShowArtist,
    setShowAlbumArt,
    setShowAlbumName,
    setShowTimestamps,
    setShowButton,
    setOnlySongs,
    setHideWhenPaused,
  } = useDiscordStore();
  const configured = isDiscordConfigured({ enabled, applicationId });

  // Buffered like the Last.fm key/secret inputs above — commit on blur
  // rather than on every keystroke, since each committed change triggers a
  // reconnect attempt to Discord's IPC socket.
  const [idInput, setIdInput] = useState(applicationId);
  const commitId = () => setApplicationId(idInput);

  return (
    <Group>
      <SettingRow
        icon={MessageCircleIcon}
        title="Discord Rich Presence"
        description="Show what you're playing on your Discord profile. Talks directly to your local Discord app — nothing is sent anywhere else."
        control={
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={enabled ? "secondary" : "outline"}
              className={
                enabled && configured
                  ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                  : undefined
              }
            >
              {!enabled ? "Disabled" : configured ? "Enabled" : "Needs Client ID"}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enable Discord Rich Presence"
            />
          </div>
        }
      />
      {enabled && (
        <>
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="discord-client-id" className="text-sm font-medium">
                Application (Client) ID
              </label>
              <Input
                id="discord-client-id"
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                onBlur={commitId}
                onKeyDown={(e) => e.key === "Enter" && commitId()}
                placeholder="Your Discord application's Client ID"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Pre-filled with YTubic&apos;s own Discord application. Don&apos;t
                change this unless you know what you&apos;re doing — it only
                needs to change if you&apos;re intentionally presenting as a
                different Discord app (e.g. one you registered yourself).
              </p>
            </div>
            <button
              type="button"
              onClick={() => openUrl(DISCORD_DEVELOPER_PORTAL_URL)}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Create a Discord application
              <ExternalLinkIcon className="size-3" />
            </button>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="discord-presence-name" className="text-sm font-medium">
                Presence name
              </label>
              <Input
                id="discord-presence-name"
                value={presenceName}
                onChange={(e) => setPresenceName(e.target.value)}
                placeholder="YouTube Music"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                The name in &quot;&lt;verb&gt; NAME&quot; — independent of
                whatever the Discord application above is actually named.
              </p>
            </div>
          </div>

          <SettingRow
            icon={ActivityIcon}
            title="Activity type"
            description='The verb in "<verb> <app name>".'
            control={
              <SegmentedControl
                value={activityType}
                onChange={setActivityType}
                options={[
                  { value: "listening", label: "Listening" },
                  { value: "playing", label: "Playing" },
                  { value: "watching", label: "Watching" },
                ]}
              />
            }
          />
          <SettingRow
            icon={TypeIcon}
            title="Track title"
            description='Shown as the "details" line.'
            control={
              <Switch
                checked={showTitle}
                onCheckedChange={setShowTitle}
                aria-label="Show track title"
              />
            }
          />
          <SettingRow
            icon={Mic2Icon}
            title="Artist"
            description='Shown as the "state" line.'
            control={
              <Switch
                checked={showArtist}
                onCheckedChange={setShowArtist}
                aria-label="Show artist"
              />
            }
          />
          <SettingRow
            icon={ImageIcon}
            title="Album art"
            description="Large cover image."
            control={
              <Switch
                checked={showAlbumArt}
                onCheckedChange={setShowAlbumArt}
                aria-label="Show album art"
              />
            }
          />
          <SettingRow
            icon={DiscAlbumIcon}
            title="Album name"
            description="Shown when hovering the cover."
            control={
              <Switch
                checked={showAlbumName}
                onCheckedChange={setShowAlbumName}
                aria-label="Show album name"
              />
            }
          />
          <SettingRow
            icon={TimerIcon}
            title="Elapsed time"
            description="Live progress bar (e.g. 01:36 / 02:51)."
            control={
              <Switch
                checked={showTimestamps}
                onCheckedChange={setShowTimestamps}
                aria-label="Show elapsed time"
              />
            }
          />
          <SettingRow
            icon={MousePointerClickIcon}
            title='"Listen" button'
            description="Links back to the track on YouTube Music."
            control={
              <Switch
                checked={showButton}
                onCheckedChange={setShowButton}
                aria-label="Show Listen button"
              />
            }
          />
          <SettingRow
            icon={FilterIcon}
            title="Only show for songs"
            description="Hide presence for standalone music videos — only share real album songs."
            control={
              <Switch
                checked={onlySongs}
                onCheckedChange={setOnlySongs}
                aria-label="Only show for songs"
              />
            }
          />
          <SettingRow
            icon={EyeOffIcon}
            title="Hide while paused"
            description="Clear presence when playback is paused, instead of freezing the bar."
            control={
              <Switch
                checked={hideWhenPaused}
                onCheckedChange={setHideWhenPaused}
                aria-label="Hide while paused"
              />
            }
          />
        </>
      )}
    </Group>
  );
}
