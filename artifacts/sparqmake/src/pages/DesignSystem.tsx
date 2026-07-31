import { MediaTile } from "@/components/ui/media-tile";
import { StateChip } from "@/components/ui/state-chip";
import { TimelineLane, TimelineRuler } from "@/components/ui/timeline-lane";
import { GenerationIndicator } from "@/components/ui/generation-indicator";
import { StageSpine, ReopenBar, type SpineStage, type SpineEdge } from "@/components/studio/StageSpine";
import { CREATIVE_STATES, type CreativeState } from "@/lib/creative-state";

/**
 * An internal reference for the v2 design system. Not in the nav.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md
 *
 * This page exists for two reasons. It lets the team see the primitives before
 * any feature consumes them, and it is the fastest way to catch a token that
 * has drifted, since everything is on one screen at once.
 *
 * Keep it honest: if a primitive looks wrong here, it is wrong. Do not fix the
 * symptom on the page, fix the primitive.
 */

const GROUND = [
  { name: "Surround", cls: "bg-surround", hex: "#0A0A0A", use: "Around the work only" },
  { name: "App", cls: "bg-background", hex: "#101010", use: "The app ground" },
  { name: "Panel", cls: "bg-card", hex: "#181818", use: "Panels and rails" },
  { name: "Raised", cls: "bg-raised", hex: "#1F1F1F", use: "Raised objects" },
  { name: "Raised 2", cls: "bg-raised-2", hex: "#262626", use: "Controls on a panel" },
];

const STATE_COLOURS = [
  { name: "Grit Teal", cls: "bg-grit-teal", hex: "#00A19C", job: "Selection, scheduled, focus" },
  { name: "Cyber Teal", cls: "bg-cyber-teal", hex: "#00F2EA", job: "Live: generating, active" },
  { name: "Victory Gold", cls: "bg-victory-gold", hex: "#FFD700", job: "Published, shipped" },
  { name: "Rebel Pink", cls: "bg-rebel-pink", hex: "#FF3864", job: "Needs attention. The only warning hue" },
  { name: "Outlaw Red", cls: "bg-outlaw-red", hex: "#EB0028", job: "Destructive and parent brand only" },
  { name: "Graphite", cls: "bg-graphite", hex: "#404B52", job: "Supporting neutral" },
];

const ALL_STATES = Object.keys(CREATIVE_STATES) as CreativeState[];

/** A post being worked normally: each stage consumed the one before it. */
const SPINE_NORMAL: SpineStage[] = [
  { id: "a", stageNumber: 1, label: "Brief", summary: "Hype post, championship run", status: "done" },
  { id: "b", stageNumber: 2, label: "Direction", summary: "Arena night · Ava K panels", status: "done" },
  { id: "c", stageNumber: 3, label: "Image", summary: "8 takes · 2 kept", status: "active" },
  { id: "d", stageNumber: 4, label: "Copy", summary: "Hook, caption, hashtags", status: "empty" },
  { id: "e", stageNumber: 5, label: "Channel crops", summary: "IG · Story · X · TikTok", status: "empty" },
];
const SPINE_NORMAL_EDGES: SpineEdge[] = [
  { from: "a", to: "b", direction: "forward" },
  { from: "b", to: "c", direction: "forward" },
  { from: "c", to: "d", direction: "forward" },
  { from: "d", to: "e", direction: "forward" },
];

/** The copy-led case: stage 03 consumed stage 04, so that edge is inverted. */
const SPINE_COPY_LED: SpineStage[] = [
  { id: "a", stageNumber: 1, label: "Brief", summary: "Hype post, championship run", status: "done" },
  { id: "b", stageNumber: 2, label: "Direction", summary: "Arena night · Ava K panels", status: "done" },
  { id: "c", stageNumber: 3, label: "Image", summary: "Fitting the locked line", status: "active" },
  { id: "d", stageNumber: 4, label: "Copy", summary: "The Floor Is Yours. Clear It.", status: "locked" },
  { id: "e", stageNumber: 5, label: "Channel crops", summary: "IG · Story · X · TikTok", status: "empty" },
];
const SPINE_COPY_LED_EDGES: SpineEdge[] = [
  { from: "a", to: "b", direction: "forward" },
  { from: "b", to: "c", direction: "forward" },
  { from: "c", to: "d", direction: "inverted" },
  { from: "d", to: "e", direction: "forward" },
];

/** After reopening Direction: what it fed is stale, the locked stage is not. */
const SPINE_STALE: SpineStage[] = [
  { id: "a", stageNumber: 1, label: "Brief", summary: "Hype post, championship run", status: "done" },
  { id: "b", stageNumber: 2, label: "Direction", summary: "Choosing the designer", status: "active" },
  { id: "c", stageNumber: 3, label: "Image", summary: "Built on the old direction", status: "stale" },
  { id: "d", stageNumber: 4, label: "Copy", summary: "Built on the old direction", status: "stale" },
  { id: "e", stageNumber: 5, label: "Channel crops", summary: "Not made yet", status: "empty" },
];

/** A stand-in image so tiles have something to desaturate and frame. */
const SAMPLE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>
      <defs><radialGradient id='g' cx='50%' cy='12%' r='80%'>
        <stop offset='0' stop-color='#2a5f7d'/><stop offset='1' stop-color='#070f16'/>
      </radialGradient></defs>
      <rect width='300' height='300' fill='url(#g)'/>
      <text x='150' y='120' text-anchor='middle' font-family='Impact,sans-serif'
        font-size='52' font-style='italic' fill='#FFD700'>GAME ON</text>
      <text x='36' y='190' font-size='40' fill='#FFD700'>&#9819;</text>
    </svg>`,
  );

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border/60 pt-8 first:border-t-0 first:pt-0">
      <div className="space-y-1.5">
        <h2 className="font-display text-lg tracking-wide text-foreground">{title}</h2>
        {note && <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function DesignSystem() {
  /*
   * The scroller is load-bearing. AppLayout's content slot is overflow-hidden,
   * so a page without its own is clipped rather than scrolled: this one was
   * losing 2799px of 3752px, meaning roughly three quarters of the design
   * system has been unreachable since it shipped. `w-full` matters too, because
   * mx-auto alone cancels flex stretch and the box shrinks to its content.
   */
  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto w-full max-w-6xl space-y-10 p-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Internal reference · not in the nav
        </p>
        <h1 className="font-display text-3xl tracking-wide text-foreground">
          The v2 design system
        </h1>
        <p className="max-w-[86ch] text-[13px] leading-relaxed text-muted-foreground">
          Two rules govern everything here. Grounds are fully desaturated, because a tinted chrome
          shifts how you perceive the imagery you are judging inside it. And saturated colour means
          state, never decoration, so every colour below has exactly one job. Client brand colours
          are content identity and never appear in chrome.
        </p>
      </header>

      <Section
        title="Ground ramp"
        note="Hue 0, saturation 0%. The previous ramp was hue 240 at 20% saturation, a blue-violet cast. Personality comes from type, density, the mark and material instead of from a tinted grey."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {GROUND.map((g) => (
            <div key={g.name} className="space-y-2">
              <div className={`h-16 rounded-sm border border-white/10 ${g.cls}`} />
              <div className="space-y-0.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  {g.name}
                </p>
                <p className="font-mono text-[9.5px] text-dim" data-numeric>
                  {g.hex}
                </p>
                <p className="text-[10px] leading-snug text-dim">{g.use}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="State colours"
        note="If a new element seems to need colour, it needs a state, not a swatch. Note that there is no green anywhere: shipped work is Victory Gold and warnings are Rebel Pink."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STATE_COLOURS.map((c) => (
            <div key={c.name} className="space-y-2">
              <div className={`h-16 rounded-sm border border-white/10 ${c.cls}`} />
              <div className="space-y-0.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  {c.name}
                </p>
                <p className="font-mono text-[9.5px] text-dim" data-numeric>
                  {c.hex}
                </p>
                <p className="text-[10px] leading-snug text-dim">{c.job}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Text tiers and figures"
        note="Every number that lines up in a column uses the mono face with tabular figures, so columns of times and costs do not shimmer as they update."
      >
        <div className="space-y-2 rounded-sm bg-card p-5">
          <p className="text-[15px] text-foreground">Foreground · #EAEAEA · primary reading text</p>
          <p className="text-[14px] text-muted-foreground">
            Muted · #A6A6A6 · secondary text, 7.3:1 on this panel
          </p>
          <p className="text-[13px] text-dim">
            Dim · #8A8A8A · labels and metadata, 5.1:1. The previous value was #666 at 3.1:1 and
            failed WCAG for small text.
          </p>
          <p className="pt-2 font-mono text-[12px] text-muted-foreground" data-numeric>
            TUE 18:30 · $0.0700 · 55.2s · 4.2K
          </p>
        </div>
      </Section>

      <Section
        title="State as material"
        note="The load-bearing idea. State lives in the frame and the imagery rather than in a badge bolted on top, so a week of work reads from across the room without anyone decoding a legend. Planned work has no image at all. A draft is desaturated rather than dimmed, because it should read as unfinished colour and not as a darker version of the finished thing."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {ALL_STATES.map((s) => (
            <div key={s} className="space-y-2">
              <MediaTile
                state={s}
                src={SAMPLE}
                alt={`${CREATIVE_STATES[s].label} example`}
                title="Championship run"
                meta="18:30"
                fanOut={s === "scheduled" ? 4 : undefined}
                agingDays={s === "failed" ? 6 : null}
              />
              <StateChip state={s} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="The grouped fan-out badge, and aging"
        note="The unit of work is one creative going to several channels, not N separate posts, so the ×N badge groups them and expands on click. The aging bar is drawn rather than buried in a tooltip: nothing else in this category shows you what has been sitting still, which is the actual reason things get stuck for weeks."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <MediaTile state="scheduled" src={SAMPLE} title="Gameday graphic" meta="08:00" fanOut={5} />
            <p className="text-[10.5px] leading-snug text-dim">Five channels, grouped</p>
          </div>
          <div className="space-y-2">
            <MediaTile
              state="failed"
              src={SAMPLE}
              title="Rivalry countdown"
              meta="Stuck"
              fanOut={2}
              agingDays={6}
            />
            <p className="text-[10.5px] leading-snug text-dim">Six days stuck, drawn as a bar</p>
          </div>
          <div className="space-y-2">
            <MediaTile state="planned" title="Post idea" meta="Suggested 17:30" />
            <p className="text-[10.5px] leading-snug text-dim">Planned, no image yet</p>
          </div>
          <div className="space-y-2">
            <MediaTile state="drafting" src={SAMPLE} title="Practice clip" meta="Draft" fanOut={2} />
            <p className="text-[10.5px] leading-snug text-dim">Drafting, desaturated</p>
          </div>
        </div>
      </Section>

      <Section
        title="Timeline"
        note="The one genuinely new primitive, and it earns its place in exactly one situation: sound has a time axis and images do not, so placing a hit at two seconds is impossible without it. Video sequences then reuse it for free. Callers pass milliseconds and never compute percentages."
      >
        <div className="space-y-1 rounded-sm bg-card p-5">
          <TimelineRuler durationMs={14_000} />
          <TimelineLane
            label="Video"
            durationMs={14_000}
            tall
            trailing="muted"
            blocks={[
              { id: "a", startMs: 0, endMs: 5000, label: "Jeffrey · to camera", sublabel: "uploaded", tone: "upload" },
              { id: "b", startMs: 5000, endMs: 9000, label: "Procedural map", sublabel: "generated", tone: "video", selected: true },
              { id: "c", startMs: 9000, endMs: 12_000, label: "Jeffrey · resumes", sublabel: "uploaded", tone: "upload" },
              { id: "d", startMs: 12_000, endMs: 14_000, label: "Bumper", sublabel: "library", tone: "library" },
            ]}
          />
          <TimelineLane
            label="Voice"
            durationMs={14_000}
            trailing="0 dB"
            blocks={[{ id: "v", startMs: 200, endMs: 12_000, tone: "voice" }]}
          />
          <TimelineLane
            label="Music"
            durationMs={14_000}
            trailing="−8 dB"
            playheadMs={5000}
            blocks={[{ id: "m", startMs: 0, endMs: 14_000, tone: "music" }]}
            markers={[
              { id: "h1", atMs: 4400, label: "Crowd swell" },
              { id: "h2", atMs: 11_500, label: "Net snap" },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Generating"
        note="The whole novelty budget is spent here and nowhere else, which is what lets every other surface stay quiet. The load-bearing detail is the second line: a spinner says wait, this says what the model has been told it may not change, so dead time becomes the one moment the brand contract is visibly enforced. The skull is a working approximation from the raster logo and should be swapped for the real vector."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-sm bg-surround">
            <GenerationIndicator
              protecting="Holding the Crown U mark exactly"
              elapsedSec={18}
              progress={0.62}
            />
          </div>
          <div className="rounded-sm bg-surround">
            <GenerationIndicator
              verb="Scoring"
              protecting="Checking every take against Crown U's palette"
              size="sm"
            />
          </div>
        </div>
      </Section>

      <Section
        title="The spine"
        note="What replaces back and forward. Those are a stack: they know only the previous step, they forget the branch you abandoned, and they cannot tell you what going back will cost. This is addressable history. Arrow direction comes from the dependency engine on the server, never from position, which is why the copy-led example below renders a reversed arrow: the graph really is reversed. Tab into a spine and use the arrow keys."
      >
        <div className="space-y-6">
          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              Normal · working at stage 03
            </p>
            <StageSpine stages={SPINE_NORMAL} edges={SPINE_NORMAL_EDGES} activeStageId="c" onOpenStage={() => {}} />
          </div>

          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              Copy-led · the hook was written first and locked, so the image was built to fit it
            </p>
            <StageSpine stages={SPINE_COPY_LED} edges={SPINE_COPY_LED_EDGES} activeStageId="c" onOpenStage={() => {}} />
            <p className="mt-2 max-w-[80ch] text-[11px] leading-relaxed text-dim">
              Copy still sits at position 04, because display order is a fixed reading convention. The arrow
              between 03 and 04 points backwards because stage 03 consumed stage 04. Position and dependency
              are different things, and only one of them needs to stay fixed.
            </p>
          </div>

          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              After reopening Direction · downstream marked stale, with the offer
            </p>
            <div className="overflow-hidden rounded-sm border border-border/60">
              <StageSpine stages={SPINE_STALE} edges={SPINE_NORMAL_EDGES} activeStageId="b" onOpenStage={() => {}} />
              <ReopenBar
                summary="Asset and copy were built on this, so they are marked stale. 1 locked stage is untouched."
                staleCount={2}
                rerunCents={19}
                onRerun={() => {}}
                onKeep={() => {}}
              />
            </div>
            <p className="mt-2 max-w-[80ch] text-[11px] leading-relaxed text-dim">
              Keep them as they are sits beside the re-run with equal weight. Reopening one decision is not
              consent to redo the things built on top of it, and the price is shown because hiding it would
              make the choice dishonest.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Focus and reduced motion"
        note="Focus is the instrument colour, so focus and selection read as the same idea. Tab through these. Motion is applied with motion-safe: and there is also a global reduced-motion block, so the forge has two independent guards."
      >
        <div className="flex flex-wrap gap-3">
          <button className="rounded-sm bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover-elevate">
            Primary action
          </button>
          <button className="rounded-sm border border-border bg-card px-4 py-2 text-[13px] text-foreground hover-elevate">
            Secondary
          </button>
          <button className="rounded-sm bg-destructive px-4 py-2 text-[13px] text-destructive-foreground hover-elevate">
            Destructive
          </button>
        </div>
      </Section>
    </div>
    </div>
  );
}
