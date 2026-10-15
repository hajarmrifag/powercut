# Demo video storyboard (target: under 3:00)

A shot list for a screen-recorded walkthrough of the real, running app on
the Vega Virtual Device — not a mockup, not narrated slides over static
screenshots. Every shot below corresponds to a flow already verified
working end-to-end (see `evidence/screenshots/phase1`, `phase2`, `phase3`).
**This storyboard does not claim or depict any user testing** — it shows
one operator demonstrating the product. If a second person appears on
camera, they are demonstrating the two-adult/shared-screen use case live,
not representing a completed study; say so on screen if that happens
("demonstration," not "user test").

Recording method: reuse the emulator-console `screenrecord` capture path
already used for every still screenshot in this repo (see
`docs/VEGA_SDK_FRICTION_LOG.md` §3) if a continuous video feed from the
console is viable; otherwise screen-record the Virtual Device window
directly (e.g. QuickTime screen recording of the VVD display) since the
documented `screenshooter` capture tool is unreliable for stills and has
not been tested for continuous video at all.

## Shot list

**0:00–0:12 — Open on the problem, not the logo.**
Cold open directly on the Overview screen, already showing INFEASIBLE and
the red energy bar (1908 Wh of 1800 Wh). No title card first — the
conflict is the hook.
> VO: *"It's 6pm, the power's out, and your battery can't run everything
> you asked for tonight. PowerCut figures out why, and what to do about
> it — on your Fire TV, so the whole household can see it at once."*
Title card ("PowerCut — Fire TV track") can appear as a small lower-third
while this plays, not a full-screen interrupt.

**0:12–0:30 — The overview, in motion.**
D-pad right across the six appliance cards, pausing briefly on the
"✓ essential" badges on Fridge and Router.
> VO: *"Six real appliances, a real battery budget, and two of them —
> fridge and router — protected by default."*

**0:30–0:55 — Make a real edit.**
Select an appliance (e.g. Fan), open its edit screen, press +1h twice live
on camera, show the "Plan is now INFEASIBLE"/"FEASIBLE" status line
actually change in response — this is the moment that proves it's a real
backend, not a scripted animation.
> VO: *"Every change you make is sent to an actual constraint solver and
> recomputed live — nothing here is hardcoded."*
Press Back to return to the overview; briefly show the energy bar having
moved.

**0:55–1:20 — Why it doesn't fit.**
Navigate to "Why, and how to fix it." Hold on the explanation text long
enough to read (e.g. "Running fridge, router, laptop, fan for their full
requested hours needs 1835 Wh, but only 1800 Wh is available...").
> VO: *"It doesn't just say no — it says exactly which combination of
> appliances breaks the budget, and by how much."*

**1:20–1:55 — Two real alternatives, side by side.**
Hold on the two alternative cards. Call out, by pointing (cursor/D-pad
focus move) rather than narration alone where possible:
- the tier badge ("✓ Protects essentials")
- the "Stays as requested" list
- the "Independently verified" badge
> VO: *"Two different fixes, calculated fresh for this exact situation —
> not a fixed pair of answers. Each one is checked twice: once by the
> solver, once by a completely separate verifier. And the automatic search
> won't touch the fridge or router unless there's truly no other option."*

**1:55–2:15 — Decide and apply.**
Select Alternative A (or B) on camera. Cut to the overview showing
FEASIBLE, green energy bar, the chosen appliance's hours visibly changed.
> VO: *"Pick one, and the household's plan for tonight is set."*

**2:15–2:40 — Why the TV.**
A brief beat (no narration needed beyond a sentence) showing the screen
from a slight distance / wider framing if possible, to sell the "shared
surface" angle — two people, one remote, one screen, making the call
together, rather than one person squinting at a phone.
> VO: *"Built for the screen two people can actually look at together when
> deciding what to sacrifice — not a one-person phone app."*

**2:40–3:00 — Close.**
Return to a clean overview shot (FEASIBLE state). End card: project name,
track, and — if true at recording time — the GitHub repo link or "ask us
for repo access" per whatever the final submission visibility decision is
(see `docs/DEVPOST_SUBMISSION_CHECKLIST.md` §1).
> VO: *"PowerCut. A real solver, a real decision, on the screen that's
> already in the room."*

## Notes for whoever records this

- Confirm the backend is running and healthy (`curl 127.0.0.1:8766/health`)
  *before* starting the recording take, not during it.
- Start from **Reset to default** so the opening INFEASIBLE state is the
  known, reproducible scenario documented in
  `docs/USER_TEST_PROTOCOL.md`.
- If a take needs a retry, reset to default again rather than cutting mid
  -flow — the live Wh/status numbers need to stay internally consistent
  shot-to-shot if any editing/trimming happens afterward.
- Keep each D-pad move on screen for at least ~1 full second before the
  next action — fast-cut D-pad mashing reads as confusing on video even
  when the app itself handles it correctly.
