import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { apiFetch, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCanWrite } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw, Loader2, CheckCircle2, MailWarning, Plug, FileWarning, Clock } from "lucide-react";
import { PlatformIcon } from "@/components/ui/platform-icon";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Phase 10 item 4 · the in-app failure surface.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG. It printed the vendor's raw error
 * string and put a Retry button on every row. For roughly half the failures the
 * build can produce, retrying is guaranteed to fail again: no account is
 * connected, the account is for another platform, the token will not decrypt.
 * A button that cannot work is worse than no button, because the person clicks
 * it, nothing changes, and they stop trusting the surface. It also listed six
 * posts separately when they were one disconnected account.
 *
 * Now the server classifies each failure and groups them, and this renders one
 * card per PROBLEM with exactly one action. Principle 1.14 is the copy rule
 * behind every string here: say what it affects, whether action is needed, and
 * whose fault it is.
 *
 * The raw vendor text is still shown, small and last, for the person debugging
 * rather than fixing. Hiding it would be its own dishonesty.
 */

export interface TypedFailure {
  kind: string;
  fault: "us" | "platform" | "you";
  title: string;
  guidance: string;
  action: "retry" | "connect_account" | "open_post";
  actionLabel: string;
  willRetryItself: boolean;
  technical: string | null;
}

export interface PublishFailure {
  id: string;
  creativeId: string;
  brandId: string | null;
  platform: string;
  scheduledAt: string;
  publishError: string | null;
  retryCount: number;
  socialAccountId: string | null;
  creativeName: string;
  accountName: string | null;
  permanent: boolean;
  typed: TypedFailure;
}

export interface FailureGroup {
  key: string;
  kind: string;
  fault: "us" | "platform" | "you";
  where: string;
  title: string;
  guidance: string;
  action: "retry" | "connect_account" | "open_post";
  actionLabel: string;
  willRetryItself: boolean;
  entries: PublishFailure[];
}

export interface PublishHealth {
  failedCount: number;
  permanentCount: number;
  groups: FailureGroup[];
  failures: PublishFailure[];
  alerts: {
    id: string;
    entryCount: number;
    channel: string;
    recipientCount: number;
    status: string;
    summary: string | null;
    sentAt: string;
    accountName: string | null;
  }[];
  emailConfigured: boolean;
}

export function usePublishHealth() {
  const [health, setHealth] = useState<PublishHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const resp = await apiFetch(`${API_BASE}/api/publish-health`);
      if (resp.ok) {
        setHealth(await resp.json());
      }
    } catch {
      // Silent — health widget is non-critical.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { health, loading, refresh };
}

/**
 * Re-queue one or more posts.
 *
 * Takes a LIST rather than an id because a card is a group and its action
 * applies to every post in it. Doing that as N separate calls to a single-id
 * hook would fire N toasts and N refreshes for one click, and the busy state
 * would track only whichever call set it last.
 */
export function useRetryEntries(onDone?: () => void | Promise<void>) {
  const { toast } = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const retry = useCallback(async (key: string, ids: string[]) => {
    setBusyKey(key);
    const failed: string[] = [];
    try {
      for (const id of ids) {
        const resp = await apiFetch(`${API_BASE}/api/calendar-entries/${id}/retry`, { method: "POST" });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          failed.push(e.error || e.message || `Failed (${resp.status})`);
        }
      }
      if (failed.length === 0) {
        toast({
          title: ids.length === 1 ? "Sending it again" : `Sending ${ids.length} again`,
          description: "They are back in the queue.",
        });
      } else {
        // Partial success is reported as partial. Saying "sent" when two of
        // five did not go is the kind of quiet lie this whole surface exists
        // to stop.
        toast({
          variant: "destructive",
          title: `${failed.length} of ${ids.length} could not be sent`,
          description: failed[0],
        });
      }
      await onDone?.();
    } finally {
      setBusyKey(null);
    }
  }, [onDone, toast]);

  return { retry, busyKey };
}

/** One icon per action, so the fix is recognisable before the words are read. */
function ActionIcon({ action }: { action: FailureGroup["action"] }) {
  if (action === "connect_account") return <Plug size={12} className="mr-1" />;
  if (action === "open_post") return <FileWarning size={12} className="mr-1" />;
  return <RotateCw size={12} className="mr-1" />;
}

/**
 * Whose end the problem is at, in three words.
 *
 * Principle 1.14: never blame the platform for our bug. Which means the reverse
 * has to be said too, or the label is just decoration: when the platform really
 * did refuse or rate limit, it is named.
 */
function faultLabel(fault: FailureGroup["fault"], where: string): string {
  if (fault === "us") return "our end";
  if (fault === "you") return "this post";
  return `${where}'s end`;
}

function GroupCard({
  group,
  canWrite,
  busyKey,
  onRetry,
}: {
  group: FailureGroup;
  canWrite: boolean;
  busyKey: string | null;
  onRetry: (key: string, ids: string[]) => void;
}) {
  const first = group.entries[0];
  const count = group.entries.length;
  const busy = busyKey === group.key;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        // Pink is the only warning hue, and only what needs a person gets it.
        // A group that heals itself is information, not an alarm.
        group.willRetryItself ? "border-border bg-muted/20" : "border-destructive/40 bg-destructive/10",
      )}
      data-testid={`card-failure-${group.kind}`}
    >
      <div className="flex items-start gap-2">
        {group.willRetryItself
          ? <Clock size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
          : <AlertTriangle size={15} className="mt-0.5 shrink-0 text-destructive" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">{group.title}</p>
          <p className="text-xs text-muted-foreground">{group.guidance}</p>
          <p className="text-xs text-muted-foreground">
            {count === 1 ? "1 post is waiting" : `${count} posts are waiting`}
            {" · "}
            {faultLabel(group.fault, group.where)}
          </p>
        </div>

        {canWrite && (
          group.action === "connect_account" ? (
            <Link href="/settings">
              <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" data-testid={`button-fix-${group.kind}`}>
                <ActionIcon action={group.action} />
                {group.actionLabel}
              </Button>
            </Link>
          ) : group.action === "open_post" ? (
            <Link href={`/studio-v2?creative=${first?.creativeId ?? ""}`}>
              <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" data-testid={`button-fix-${group.kind}`}>
                <ActionIcon action={group.action} />
                {group.actionLabel}
              </Button>
            </Link>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={busy}
              onClick={() => onRetry(group.key, group.entries.map((e) => e.id))}
              data-testid={`button-fix-${group.kind}`}
            >
              {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <ActionIcon action={group.action} />}
              {group.actionLabel}
            </Button>
          )
        )}
      </div>

      <div className="space-y-0.5 pl-6">
        {group.entries.slice(0, 4).map((f) => (
          <div key={f.id} className="flex items-center gap-1.5 min-w-0" data-testid={`row-publish-failure-${f.id}`}>
            <PlatformIcon platform={f.platform} className="w-3 h-3 shrink-0" />
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              <span className="text-foreground">{f.creativeName}</span>
              {" · "}
              {new Date(f.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
        ))}
        {count > 4 && <p className="text-xs text-muted-foreground">and {count - 4} more</p>}
        {/* The vendor's own words, last and quiet: for the person debugging
            rather than the person fixing. Removing it would hide something the
            system was told. */}
        {first?.typed?.technical && (
          <p className="pt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground/70 break-all" data-testid="text-technical">
            {first.typed.technical}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Prominent banner listing what is stopping posts from publishing, one card per
 * problem. Renders nothing while loading or when there is nothing wrong.
 */
export function PublishHealthBanner({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const canWrite = useCanWrite();
  const { health, refresh } = usePublishHealth();
  const { retry, busyKey } = useRetryEntries(async () => {
    await refresh();
    await onChanged?.();
  });

  if (!health || health.failedCount === 0) return null;

  const groups = health.groups ?? [];
  const needingAPerson = groups.filter((g) => !g.willRetryItself).length;

  return (
    <div className="space-y-2" data-testid="banner-publish-health">
      <p className="text-sm font-semibold text-foreground">
        {health.failedCount} scheduled post{health.failedCount === 1 ? "" : "s"} did not publish
        {needingAPerson > 0 && (
          <span className="font-normal text-muted-foreground">
            {" · "}{needingAPerson === 1 ? "one thing needs you" : `${needingAPerson} things need you`}
          </span>
        )}
      </p>

      {groups.map((g) => (
        <GroupCard key={g.key} group={g} canWrite={canWrite} busyKey={busyKey} onRetry={retry} />
      ))}

      {!health.emailConfigured && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-email-not-configured">
          <MailWarning size={12} className="shrink-0" />
          Nobody is emailed when this happens. An admin can turn that on in the server settings.
        </p>
      )}
    </div>
  );
}

/**
 * Compact "Publish health" card for the admin dashboard. Always renders: green
 * when everything published, the problems otherwise.
 */
export function PublishHealthCard() {
  const canWrite = useCanWrite();
  const { health, loading, refresh } = usePublishHealth();
  const { retry, busyKey } = useRetryEntries(refresh);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-6" data-testid="card-publish-health">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        {health && health.failedCount > 0 ? (
          <AlertTriangle size={16} className="text-destructive" />
        ) : (
          <CheckCircle2 size={16} className="text-green-400" />
        )}
        Publish Health
      </h3>
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-muted/40" />
      ) : !health || health.failedCount === 0 ? (
        <p className="text-sm text-muted-foreground">Everything scheduled has published.</p>
      ) : (
        <div className="space-y-2">
          {(health.groups ?? []).slice(0, 3).map((g) => (
            <GroupCard key={g.key} group={g} canWrite={canWrite} busyKey={busyKey} onRetry={retry} />
          ))}
          {health.alerts.length > 0 && (
            <p className="text-[10px] text-muted-foreground pt-1">
              Last alert: {new Date(health.alerts[0].sentAt).toLocaleString()} ({health.alerts[0].status}, {health.alerts[0].entryCount} post{health.alerts[0].entryCount === 1 ? "" : "s"})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
