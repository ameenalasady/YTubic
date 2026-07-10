import { useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ActivityIcon,
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
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useLastfmStore, isLastfmLinked } from "@/lib/store/lastfm";
import { authorizeUrl, getSession, getToken } from "@/lib/lastfm/api";
import { useDiscordStore, isDiscordConfigured } from "@/lib/store/discord";

export function IntegrationsTab() {
  return (
    <TabPane tightTop>
      <LastfmGroup />
      <DiscordGroup />
    </TabPane>
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
    scrobblingEnabled,
    loveSyncEnabled,
    setCredentials,
    setSession,
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
