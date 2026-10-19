# Demo video storyboard (target: approximately 1:55 to 2:05, hard ceiling 3:00)

A shot list and narration script for a screen-recorded walkthrough of the
real, running app on the Vega Virtual Device, not a mockup, not narrated
slides over static screenshots. Every shot below was actually captured,
and every number shown was cross-checked against the live in-app engine
at the moment of capture.

This document describes the current, approved cut: the household-priority
scenario (marking the fan essential, and watching the solver's own
recommendation change as a result), not an earlier draft scenario that
this file described in a prior revision. See "Video file history" below
for how the local artifacts relate to each other.

## Positioning (read this before recording or narrating a final take)

**PowerCut is a household outage-*preparation* tool, used before a power
outage, while the household still has power, electricity, and a working
TV.** It helps a household plan *in advance* which appliances to run on
battery backup and for how long, given a battery budget. Nothing about
the product, the UI, or this script should imply the television itself
keeps working *during* a blackout. That would misrepresent what a Fire
TV app can do. The framing throughout is "plan tonight's outage now,
before it happens," not "this app is running while the lights are out."

The appliance wattage ranges shown on screen (e.g. "45-65 W" for a
laptop) are **illustrative estimates for this prototype, not measurements
of any real household's devices**: the app's own footer text says so
("Synthetic estimates...") and the narration says so too, once,
explicitly, rather than relying on viewers to read the small print.

The repair tagged "requires compromise" (reducing fridge hours once fan
is also marked essential) is flagged on screen and in narration as
verified against the energy math only, not a guarantee of food safety.
The narration never claims this is the household's *only* remaining fix;
it describes what changed about the solver's recommendation, not an
exhaustive search of every possible repair.

No claim of completed user testing appears anywhere in this video or
script. `docs/USER_TEST_PROTOCOL.md` is the instrument for that test;
no session has been run yet.

## What was actually captured, and how (read before re-recording)

Recording method: the emulator console's `screenrecord start`/`stop`
capture path (see `docs/VEGA_SDK_FRICTION_LOG.md` section 6), which
produces a native 1920x1080 VP9/WebM file directly from the Virtual
Device: no manual scaling, no window capture, no QuickTime screen
recording needed.

**Important limitation discovered during capture** (also logged in the
friction log): once a `screenrecord` session is active, D-pad input sent
via the normal `vda shell inputd-cli button_press` path does not reach
the app at all, confirmed by recording a full button-press sequence and
finding the on-device app state frozen at its starting point for the
entire take, both in the video and in a live screenshot taken
immediately after stopping. The emulator console's lower-level
`event send EV_KEY:...` input injection sometimes moves D-pad focus
during an active recording, but this was found to be unreliable across
sessions, and it does not trigger Select/Enter activation through any
keycode tried. Continuous, single-take footage of every keypress is not
currently achievable with the documented tools.

**What this means for the actual capture**: each shot is a short,
continuous recording of one real app state, held on screen for several
seconds. All state changes between shots (marking an appliance essential,
applying an alternative, navigating) were performed between recordings,
using the fully reliable `vda shell inputd-cli` path, and each resulting
state was verified against a screenshot and the live in-app engine's own
numbers before recording continued. **Every frame in the assembled video
is real, live app footage: nothing is a mockup, a static image dressed
up as the app, or narrated over slides.** The cuts between shots are
ordinary editing cuts, not simulated UI.

In post, each raw clip was extended with a held (frozen) final frame so
the narration has room to breathe. This is standard editing practice (a
"hold," not a loop or an animation) and is disclosed here rather than
left implicit. The raw, un-extended clips are kept locally for anyone who
wants to see the unedited captures.

## The scenario (exact, reproducible, numbers verified against the running engine)

Starting point: the shipped default, a 12-hour outage, 1800 Wh / 200 W
battery, six appliances at default hours (fridge 12h, router 12h, lamp
4h, phone 1h, laptop 3h, fan 4h). This is INFEASIBLE (needs 1908 Wh).

1. Open "Why, and how to fix it." Two independently verified alternatives
   are shown, both tagged "Protects essentials":
   - **Alternative A**: laptop 3h to 1h. 1778 Wh used, 22 Wh left, 185 W
     peak.
   - **Alternative B**: fan 4h to 1h. 1758 Wh used, 42 Wh left, 197 W
     peak.
2. Mark **fan essential** from its own edit screen (one button press).
   The plan is still INFEASIBLE (hours unchanged), and the overview now
   shows fridge, router, and fan all essential-badged.
3. Reopen the alternatives screen with fan now essential:
   - **Alternative A is unchanged**: laptop 3h to 1h, still tagged
     "Protects essentials," 1778 Wh used, 22 Wh left, 185 W peak (laptop
     alone is already sufficient regardless of fan's status).
   - **Alternative B has changed**: it no longer touches fan. It now
     reduces **fridge 12h to 10h**, tagged "Requires compromise," 1728 Wh
     used, 72 Wh left, 185 W peak, with the on-screen safety caution
     ("Verified against the energy math only, not a guarantee of food
     safety") visible since it touches fridge.
4. Apply **Alternative A**. Result: back to **FEASIBLE**, 1778 Wh used,
   laptop at 1h, and **fan still at 4h and still essential-badged**,
   proving the household's protected appliance was never touched.

This sequence demonstrates the three required story points at once:
household-selected priorities genuinely changing the solver's output (not
just a relabel), the real verified constraint solver, and the standalone
Vega engine (the Python reference backend is confirmed stopped throughout
capture).

## Shot list, timing, and narration (current cut)

Durations below are the actual, measured lengths of the committed cut's
video segments, each extended just enough past its raw capture to match
its narration (see "Video file history").

**Title card (about 11s).**
Text: "PowerCut / Plan a household power outage before it happens / Fire
TV prototype, Amazon Build, Ship, Shape 2026."
> Narration: "A power outage is coming. Before it hits, PowerCut helps a
> household decide which appliances matter most, and proves every plan
> with a real solver, not a guess."

**Segment 1, about 16s: the problem, already prepared for.**
Overview screen, default state: INFEASIBLE, red energy bar, 1908 Wh of
1800 Wh, fridge and router essential-badged.
> Narration: "Six real appliances share one battery budget. Fridge and
> router are protected by default, food safety and connectivity that stay
> put unless the household says otherwise. Tonight, as requested, the
> plan does not fit."

**Segment 2, about 23s: the original alternatives.**
Alternatives screen, default essentials: explanation text, Alternative A
(laptop, protects essentials), Alternative B (fan, protects essentials).
> Narration: "The solver offers two independently verified fixes. Cut the
> laptop down to one hour, or cut the fan down to one hour. Either way,
> fridge and router stay exactly as they are, and every repair is checked
> twice, once by the solver, once by a separate verifier, before it's
> ever shown."

**Segment 3, about 9s: marking the fan essential.**
Fan edit screen, just marked essential: "Fan, essential service," plan
still INFEASIBLE.
> Narration: "Tonight, the household decides the fan matters just as
> much. One press on the remote, and it joins fridge and router as
> essential."

**Segment 4, about 6s: the choice reaches the solver.**
Overview screen, now showing fridge, router, and fan all essential-badged,
still INFEASIBLE.
> Narration: "That is not just a label on the screen. It goes straight
> into the solver itself."

**Segment 5, about 29s: the payoff, before and after.**
Alternatives screen with fan essential: Alternative A unchanged (laptop),
Alternative B changed to "Requires compromise," reducing fridge 12h to
10h, with the safety caution visible.
> Narration: "Before, cutting the fan was one way to fix tonight's plan.
> Now that the fan is protected, that option is gone, and the solver's
> recommendation changes with it: it now points to the fridge instead,
> honestly flagged as a compromise. The app is clear about what that
> means too: verified against the energy math only, not a guarantee that
> food stays safely cold."

**Segment 6, about 12s: applied, and feasible again.**
Overview screen after applying Alternative A: FEASIBLE, 1778 of 1800 Wh,
laptop at 1h, fan still at 4h and still essential-badged.
> Narration: "Apply the laptop fix, and tonight's plan is feasible again,
> with the fan exactly where the household put it: essential, and never
> touched."

**End card, about 13s.**
Text: "PowerCut / Fire TV track, Amazon Build, Ship, Shape 2026 / A real
solver. Independently verified. Runs standalone, no server. / A
prototype, not yet tested with real households. / All figures are
illustrative estimates, not guarantees."
> Narration: "No cloud, no companion device. PowerCut's solver runs
> entirely on the Fire TV itself, a prototype built on illustrative
> estimates, not yet tested with real households."

Total runtime: approximately 1:59, within the 1:55 to 2:05 target and
well under the 3:00 ceiling.

## Video file history (all local only, gitignored, never published)

- `evidence/video/powercut-demo-preliminary.webm`: an earlier preliminary
  cut from the original laptop/fan-hours scenario. Kept for reference,
  not the current cut.
- `evidence/video/powercut-demo-final-draft.webm`: the approved silent cut
  of the current household-priority (fan-essential) scenario described
  above.
- `evidence/video/powercut-demo-narrated.webm`: a first narrated pass
  over that same cut. Superseded by v2 below; corrected an inaccurate
  claim that the fridge-reducing repair was the household's "only other
  fix."
- `evidence/video/powercut-demo-v2-narrated-preview.webm`: the current
  cut and narration described in this document, with tighter holds, a
  shortened ending, and the corrected narration. Narrated with a
  temporary system text-to-speech voice for timing review; the final
  voice has not yet been chosen.
- `evidence/video/narration-script.txt` / `narration-script-v2.txt`: the
  narration scripts for the first and current narrated passes.

Every file above remains local only. None has been published, uploaded,
or submitted anywhere.

## Notes for whoever re-records or re-edits this

- Confirm the backend is stopped (`curl 127.0.0.1:8766/health` should
  fail to connect) before recording, to keep the "standalone, no server"
  claim demonstrated rather than merely asserted.
- Relaunch the app fresh (`vega run-app ...`) before the first take so
  the opening INFEASIBLE state is the known default: don't rely on
  "Reset to default" alone, since D-pad focus does not reliably reset
  the same way a fresh launch does.
- Record each shot as its own short `screenrecord start --time-limit N`
  clip; perform the state-changing button presses *between* recordings
  via `vda shell inputd-cli button_press`, and verify each resulting
  state with a console screenshot before recording the next clip. Do not
  attempt to press buttons while a recording is active (see the
  limitation above). Do not rely on `event send` D-pad injection during
  an active recording either; it was reliable once and unreliable on a
  later attempt, with no identified cause.
- After Fridge/Router/etc. focus: navigating from the appliance row to
  the action row (Battery / Why-and-fix-it / Reset) does not reliably
  land on a predictable card by column position: screenshot and reorient
  rather than assuming a fixed number of D-pad presses.
- Keep the raw per-shot clips locally so a re-edit never has to re-record
  from scratch.
- When trimming hold durations to match a new narration script, measure
  the narration audio's actual duration first (voices and scripts vary
  in speaking rate), then set each segment's hold to that duration plus
  a small lead-in and trailing buffer, rather than picking a round target
  number first.
