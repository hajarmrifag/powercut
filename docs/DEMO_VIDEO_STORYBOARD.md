# Demo video storyboard (target: ~2:35, hard ceiling 3:00)

A shot list and voiceover script for a screen-recorded walkthrough of the
real, running app on the Vega Virtual Device, not a mockup, not narrated
slides over static screenshots. Every shot below was actually captured
(see `evidence/video/powercut-demo-preliminary.webm`, a locally-assembled
preliminary cut built entirely from real device footage, **not uploaded
or published anywhere**; see `README`/submission checklist), and every
number shown was cross-checked against a live `curl` call to the backend
at the moment of capture.

## Positioning (read this before recording a final take)

**PowerCut is a household outage-*preparation* tool, used before a power
outage, while the household still has power, electricity, and a working
TV.** It helps a household plan *in advance* which appliances to run on
battery backup and for how long, given a battery budget. Nothing about
the product, the UI, or this script should imply the television itself
keeps working *during* a blackout. That would misrepresent what a Fire
TV app can do. The framing throughout is "plan tonight's outage now,
before it happens," not "this app is running while the lights are out."

The appliance wattage ranges shown on screen (e.g. "45–65 W" for a
laptop) are **illustrative estimates for this prototype, not measurements
of any real household's devices**: the app's own footer text says so
("Synthetic estimates...") and the voiceover should say so too, once,
explicitly, rather than relying on viewers to read the small print.

No claim of completed user testing appears anywhere in this video or
script. `docs/USER_TEST_PROTOCOL.md` is the instrument for that test;
no session has been run yet.

## What was actually captured, and how (read before re-recording)

Recording method: the emulator-console `screenrecord start`/`stop`
capture path (see `docs/VEGA_SDK_FRICTION_LOG.md` §6), which produces a
native 1920×1080 VP9/WebM file directly from the Virtual Device: no
manual scaling, no window capture, no QuickTime screen recording needed.

**Important limitation discovered during this capture** (also logged in
the friction log): once a `screenrecord` session is active, D-pad input
sent via the normal `vda shell inputd-cli button_press` path does not
reach the app at all: confirmed by recording a full button-press
sequence and finding the on-device app state frozen at its starting
point for the entire take, both in the video and in a live screenshot
taken immediately after stopping. The emulator console's lower-level
`event send EV_KEY:...` input injection *does* move D-pad focus during an
active recording, but does **not** trigger Select/Enter (card and button
activation) through any of the candidate keycodes tried
(`KEY_ENTER`, `KEY_SELECT`, `KEY_OK`, `KEY_CENTER`), so continuous,
single-take footage of every keypress is not currently achievable with
the documented tools.

**What this means for the actual capture**: each shot below is a short,
continuous recording of one real app state, held on screen for several
seconds. All state changes between shots (selecting an appliance,
pressing −1h/+1h, applying an alternative) were performed between
recordings, using the fully-reliable `vda shell inputd-cli` path, and
each resulting state was verified against a screenshot and the backend's
own numbers before recording continued. **Every frame in the assembled
video is real, live app footage: nothing is a mockup, a static image
dressed up as the app, or narrated over slides.** The cuts between shots
are ordinary editing cuts, not simulated UI.

In post, each raw clip's final frame was held (frozen) for several
additional seconds to give the voiceover room to breathe. This is
standard editing practice (a "hold," not a loop or an animation) and is
disclosed here rather than left implicit. The raw, un-extended clips are
kept at `evidence/video/raw-segments/` for anyone who wants to see the
unedited captures.

## The scenario (exact, reproducible, numbers verified live against the backend)

Starting point: the shipped default, a 12-hour outage, 1800 Wh / 200 W
battery, six appliances at default hours (fridge 12h, router 12h, lamp
4h, phone 1h, laptop 3h, fan 4h). This is INFEASIBLE (needs 1908 Wh).

1. Reduce **laptop 3h → 1h** (two presses of −1h). Result: **FEASIBLE**,
   1778 Wh used, 22 Wh left, 185 W peak.
2. Increase **fan 4h → 5h** (one press of +1h). Result: **INFEASIBLE**
   again: 1828 Wh needed against the 1800 Wh budget.
3. Open "Why, and how to fix it." The live explanation: *"Running fridge,
   router, lamp, laptop, fan for their full requested hours needs 1803
   Wh, but only 1800 Wh is available — a shortfall of 3 Wh. That is the
   smallest set of services that alone breaks the battery budget."*
4. Two independently-verified alternatives are shown, both tagged
   "✓ Protects essentials":
   - **Alternative A**: fan 5h → 4h. 1778 Wh used, 22 Wh left, 185 W peak.
   - **Alternative B**: laptop 1h → 0h. 1763 Wh used, 37 Wh left, 170 W
     peak.
5. Apply **Alternative A**. Result: back to **FEASIBLE**, 1778 Wh used,
   fan restored to 4h, laptop still at 1h from step 1.

This exact sequence (infeasible → feasible → infeasible → explained
conflict → verified repair → feasible) is what's on screen in
`evidence/video/powercut-demo-preliminary.webm`.

## Shot list, timing, and voiceover

**0:00–0:12 (12s): Open on the problem, already prepared for.**
Cold open on the Overview screen: INFEASIBLE, red energy bar, 1908 Wh of
1800 Wh. A small lower-third title can appear ("PowerCut: Fire TV
track") without interrupting the shot.
> VO: *"Before an outage happens, PowerCut helps a household plan which
> appliances to run on battery backup, and for how long. Six real
> appliances, a real battery budget, and two of them, fridge and router,
> protected by default. Right now, this plan doesn't fit."*

**0:12–0:26 (14s): Make a real edit.**
Hold on the Laptop edit screen: "1h required," "Plan is now FEASIBLE" in
green.
> VO: *"Every number here is an illustrative estimate, not a measurement
> of a real appliance, but every change is sent to an actual constraint
> solver and recomputed live. Cutting the laptop down to one hour makes
> tonight's plan fit."*

**0:26–0:36 (10s): Confirm it globally.**
Hold on the Overview, now FEASIBLE, green bar, 1778 of 1800 Wh, laptop
card showing 1h.
> VO: *"The whole household's plan updates, not just one card."*

**0:36–0:50 (14s): Break it again, honestly.**
Hold on the Fan edit screen: "5h required," "Plan is now INFEASIBLE" in
red.
> VO: *"Ask for one more hour from the fan, and the same real solver
> says no: this isn't a scripted demo path, it's live math."*

**0:50–1:45 (55s): Why, and two verified fixes.**
Hold on the conflict/alternatives screen. Let the explanation text and
both alternative cards sit on screen long enough to read in full.
> VO: *"PowerCut doesn't just say no. It says exactly which combination
> of appliances breaks the budget, and by how much: three watt-hours,
> in this case. Then it offers two different repairs, calculated fresh
> for this exact situation, not a fixed pair of answers. Each one is
> checked twice: once by the solver, once by a completely separate
> verifier. And the automatic search won't touch the fridge or router
> unless there's truly no other option."*

**1:45–2:25 (40s): Decide, and close on the plan that fits.**
Hold on the Overview, back to FEASIBLE, green bar, fan restored to 4h.
> VO: *"Pick one, and tonight's plan is set, before the power ever goes
> out. Built for the screen a household can look at together while
> they're still deciding, not a one-person phone app they check after
> the fact."*
End-card note for the editor: add a ~10-second title card here (project
name, "Fire TV track," and the repo-access line from
`docs/DEVPOST_SUBMISSION_CHECKLIST.md` once that's finalized) to close
out at roughly 2:35. This is a plain text card, not simulated app UI.

## Notes for whoever re-records or re-edits this

- Confirm the backend is healthy (`curl 127.0.0.1:8766/health`) before
  recording, not during it.
- Relaunch the app fresh (`vega run-app ...`) before the first take so
  the opening INFEASIBLE state is the known default: don't rely on
  "Reset to default" alone, since D-pad focus does not reliably reset
  the same way a fresh launch does.
- Record each shot as its own short `screenrecord start --time-limit N`
  clip; perform the state-changing button presses *between* recordings
  via `vda shell inputd-cli button_press`, and verify each resulting
  state with a console screenshot before recording the next clip. Do not
  attempt to press buttons while a recording is active (see the
  limitation above).
- After Fridge/Router/etc. focus: navigating from the appliance row to
  the action row (Battery / Why-and-fix-it / Reset) does not reliably
  land on a predictable card by column position: screenshot and
  reorient rather than assuming a fixed number of D-pad presses.
- Keep the raw per-shot clips in `evidence/video/raw-segments/` so a
  re-edit never has to re-record from scratch.
