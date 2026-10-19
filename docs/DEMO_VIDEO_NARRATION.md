# Demo video narration script (current, finalized wording)

The finalized narration for the current demo video cut described in
`docs/DEMO_VIDEO_STORYBOARD.md`. This is the wording, not the audio: it
was recorded as a temporary preview using a built-in macOS text-to-speech
voice (Samantha) so the timing could be reviewed, and the final voice has
not yet been chosen. The video file this was recorded against is
`evidence/video/powercut-demo-v2-narrated-preview.webm`, local only and
not published.

This revision corrects an inaccuracy in the prior narration pass: it no
longer claims that reducing fridge hours is the household's "only other
fix." It instead describes what changed about the solver's own
recommendation once the fan is marked essential, without claiming that
repair is exhaustive or exclusive.

## Title card (about 11s)

A power outage is coming. Before it hits, PowerCut helps a household
decide which appliances matter most, and proves every plan with a real
solver, not a guess.

## Segment 1: the problem (about 16s)

Six real appliances share one battery budget. Fridge and router are
protected by default, food safety and connectivity that stay put unless
the household says otherwise. Tonight, as requested, the plan does not
fit.

## Segment 2: the original alternatives (about 23s)

The solver offers two independently verified fixes. Cut the laptop down
to one hour, or cut the fan down to one hour. Either way, fridge and
router stay exactly as they are, and every repair is checked twice, once
by the solver, once by a separate verifier, before it's ever shown.

## Segment 3: marking the fan essential (about 9s)

Tonight, the household decides the fan matters just as much. One press on
the remote, and it joins fridge and router as essential.

## Segment 4: the choice reaches the solver (about 6s)

That is not just a label on the screen. It goes straight into the solver
itself.

## Segment 5: the payoff, before and after (about 29s)

Before, cutting the fan was one way to fix tonight's plan. Now that the
fan is protected, that option is gone, and the solver's recommendation
changes with it: it now points to the fridge instead, honestly flagged as
a compromise. The app is clear about what that means too: verified
against the energy math only, not a guarantee that food stays safely
cold.

## Segment 6: applied, and feasible again (about 12s)

Apply the laptop fix, and tonight's plan is feasible again, with the fan
exactly where the household put it: essential, and never touched.

## End card (about 13s)

No cloud, no companion device. PowerCut's solver runs entirely on the
Fire TV itself, a prototype built on illustrative estimates, not yet
tested with real households.

## What this script keeps, and why

- **Illustrative estimates**: stated once, explicitly, in the title and
  reinforced in the end card, matching the app's own footer text rather
  than leaving it to on-screen small print.
- **Safety limitation**: segment 5 states plainly that the fridge
  repair is verified against the energy math only, not a guarantee of
  food safety, matching the on-screen caution text exactly.
- **Independent mathematical verification**: segment 2 states that every
  repair is checked twice, once by the solver and once by a separate
  verifier, before it is ever shown.
- **Standalone Vega engine**: the end card states the solver runs
  entirely on the Fire TV itself, with no cloud and no companion device,
  matching the capture condition (the Python reference backend confirmed
  stopped throughout recording).
- **No completed user testing claim**: never asserted anywhere in this
  script.
