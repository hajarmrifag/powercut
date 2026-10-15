# PowerCut: two-adult shared-screen test protocol

A short, structured session to find out three things: do two people
understand *why* a plan doesn't fit, how do they actually choose between two
verified repairs, and is a shared TV screen doing anything a phone wouldn't.
This is a formative check on a handful of pairs, not a statistically
powered study — treat the findings as "worth investigating further" or
"worth dropping," not as proof.

## Stable demo scenario

Use the app's shipped default, unedited: a 12-hour outage, a 1800 Wh / 200 W
battery, and the six built-in appliances at their default requested hours
(fridge 12h, router 12h, lamp 4h, phone 1h, laptop 3h, fan 4h). This
scenario is deliberately infeasible (needs 1908 Wh against 1800 Wh
available) and has two independently-verified repairs that both protect
fridge and router (laptop → 1h, or fan → 1h) — no setup is required beyond
launching the app, or pressing **Reset to default** on the overview if a
previous session left it in a different state.

## Before the session

- One Vega Virtual Device (or real Fire TV) with PowerCut installed, and the
  backend running and reachable, confirmed working beforehand — don't debug
  infrastructure in front of participants.
- One remote, placed on the shared surface between the two participants
  (not handed to one person to hold) — if two remotes are available, place
  both.
- A facilitator with this document and a simple notes sheet (see
  *What to record*, below). The facilitator does not operate the remote.
- Tell participants upfront, in these or similar words: *"This is a
  prototype for planning which appliances to run on battery backup during a
  power outage. The numbers are synthetic estimates for this test, not
  measurements of your real devices. There's no wrong way to use it — we
  want to see how it works for you, not test you."*

## Roles

Two adult participants, sharing the one screen and remote(s). No
facilitator intervention during the task itself except the prompts below —
let silences and disagreements play out; that's the data.

## Script (≈5 minutes)

**0:00 – Orient (30s).** *"This shows tonight's outage plan. Take a look —
what does the screen tell you?"* Let them read the overview unprompted.
Note whether they notice the INFEASIBLE badge and the energy bar
unprompted, before any hint.

**0:30 – Understand the conflict (90s).** *"The plan says INFEASIBLE. Can
you find out why?"* Watch whether they navigate to the "Why, and how to fix
it" tile themselves. Once there, ask: *"In your own words, what's the
problem?"* This is the key comprehension check — do they explain it as
"too much power needed" (correct) or something else (e.g., blame a specific
appliance that isn't actually the cause)?

**2:00 – Compare the two repairs (90s).** *"There are two ways to fix this.
Look at both before picking one."* Don't explain the cards. Watch whether
they read the tier badge (protects essentials / requires compromise), the
"stays as requested" list, and the trade-off summary, or just look at the
hour numbers. Ask: *"What's different between A and B?"* and *"Which one
would you pick, and why?"*

**3:30 – Decide and apply (60s).** *"Go ahead and apply the one you'd
choose."* Watch who holds the remote and whether the other person
participates in the decision or just watches. Confirm the overview now
shows FEASIBLE together.

**4:30 – Wrap-up questions (30s).** Ask verbally, don't make them navigate
further:
1. "On a scale of 1–5, how clear was it why the original plan didn't work?"
2. "Did seeing this on the TV together change how you talked about it,
   compared to one of you looking at a phone?"
3. "Was there anything you expected to be able to change or see that
   wasn't there?"

## What to record

For each pair, the facilitator notes (not participant-filled):

- Did they find the conflict explanation without being told the tile
  exists? (yes / with a hint / no)
- Their own-words explanation of the conflict: correct / partially correct
  / incorrect — quote it if possible.
- Did they look at *both* alternatives before choosing, or pick the first
  one shown?
- Which alternative they chose, and their stated reason.
- Did both participants engage with the decision, or did one drive while
  the other disengaged?
- Any D-pad navigation friction: lost focus, unsure which direction to
  press, pressed Back expecting something else, etc. — note *where* exactly
  in the flow, not just "navigation was confusing."
- Any moment the on-screen status didn't seem to match what they expected,
  even if ultimately correct — this flags clarity issues even when the
  system is technically right.
- The three closing question answers, verbatim where feasible.

## What this test does and doesn't establish

It can tell you whether the current conflict explanation and alternative
cards are legible to two people who have never seen the app, and whether a
shared screen visibly changes how they talk to each other versus one person
narrating from a phone. It cannot tell you whether the shared screen is
*better* than a phone for this task — that needs a matched-pair comparison
(same task, phone vs. TV, counterbalanced order across several pairs),
which is future work, not this protocol. A single pair, or even a handful,
is formative evidence for fixing obvious friction, not a go/no-go
statistic.
