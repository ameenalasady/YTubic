import { useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLinkIcon,
  HeartIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  Music2Icon,
  RadioIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Group, SettingRow, TabPane } from "@/components/settings/primitives";
import { useLastfmStore, isLastfmLinked } from "@/lib/store/lastfm";
import { authorizeUrl, getSession, getToken } from "@/lib/lastfm/api";

export function IntegrationsTab() {
  return (
    <TabPane tightTop>
      <LastfmGroup />
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
