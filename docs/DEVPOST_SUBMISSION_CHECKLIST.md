# Devpost submission checklist

A working checklist for submitting PowerCut to the Amazon Build, Ship,
Shape 2026 Hackathon, Fire TV track. **Nothing here has been submitted.**
Items marked **VERIFY** depend on the official rules page
(`amazonappdev2026.devpost.com/rules`) as it reads at submission time, not
as it read when it was last checked during this project's feasibility
phase (12 October 2026); re-read it before acting on those items, since
rules pages can change and this list does not re-fetch it.

## 1. Repository access

- [ ] Repo is currently **private**. **VERIFY**: does the current ruleset
      require a public repo, or is private-with-reviewer-access
      acceptable? If reviewer access is allowed, add the specific
      organizer/judge GitHub accounts or team as collaborators rather than
      making the repo public, and ask the organizers which they need if the
      rules page doesn't say.
- [ ] If the repo must go public, decide *when* (some rules want it public
      only at/after the submission deadline, not before, to prevent
      early-viewing advantages). **VERIFY** this too.
- [ ] Confirm `.gitignore` still excludes `node_modules`, build output, and
      `.claude/` before any visibility change. Already true as of the
      Phase 3 commit; re-check if more commits land before submitting.
- [ ] Re-run the secret scan used for every commit so far
      (`git diff --cached` grepped for key/token/secret patterns) one more
      time immediately before changing visibility, not just before the
      last commit.

## 2. Build instructions

- [ ] README's "Running it on Vega" section is current (Prerequisites,
      Install and build, Run), confirmed working end-to-end from a fresh
      `gh repo clone` as of the Phase 1 verification pass; re-verify after
      any further commits.
- [ ] The README assumes the reader already has the Vega SDK installed; it
      links the official install doc but does not walk through SDK
      installation itself. Decide whether judges are expected to install
      the SDK and build themselves, or whether the demo video is the
      primary artifact for judging (see §5); if the former, consider
      whether SDK install steps belong in the README too.
- [x] Outdated as of Phase A: the shipped app no longer needs the Python
      backend. `src/engine/` runs the solver/verifier/repair search
      in-process inside the Vega app; `backend/server.py` is kept only as
      the reference implementation and differential-test oracle, and is
      optional to run at all (see README, "Reference implementation and
      test oracle"). Confirmed on-device with the backend stopped.

## 3. Licensing

- [x] **`LICENSE` added**: MIT, copyright 2026 Hajar Mrifag. Covers this
      repository's own original source only (`src/`, `engine/`, `backend/`,
      `test/`, docs); the Amazon Vega SDK and `@amazon-devices/*` packages
      remain under Amazon's own terms and are not redistributed by this
      repository (see README, "License").
- [ ] **VERIFY** whether the hackathon rules require an OSS license for
      eligibility or judging, or whether a private/unlicensed repo is
      acceptable for a hackathon entry.
- [ ] No third-party code is vendored into the shipped engine (`solver.py`,
      `verifier.py`, `run_experiment.py`, `repairs.py` are original,
      standard-library-only; see README, "Why the engine is vendored").
      GridFlex was inspected as reference material during feasibility but
      no GridFlex code is in this repository. npm/React Native dependencies
      carry their own upstream licenses via `node_modules`, which is not
      committed (standard practice: consumers get those licenses through
      `npm install`, not a vendored copy).

## 4. Product feedback (sponsor-tech feedback, if the rules ask for it)

- [ ] `docs/VEGA_SDK_FRICTION_LOG.md` is a ready-made, evidence-based
      account of real friction encountered (build-path-with-spaces,
      Virtual Device display scaling, capture-tool failures, process
      lifecycle, a couple of CLI argument quirks), reusable as-is or
      excerpted if the submission form has a dedicated feedback field.
      **VERIFY** whether such a field exists and what it expects.

## 5. Demo video

- [ ] `docs/DEMO_VIDEO_STORYBOARD.md` is a shot-by-shot script for a
      sub-three-minute demo of the actual running product (not a mockup,
      not narrated slides), ready to record from the Virtual Device using
      the same capture method already used for every screenshot in
      `evidence/`.
- [ ] **VERIFY** the exact length limit and hosting requirement (commonly
      YouTube or Vimeo, sometimes unlisted is fine, sometimes must be
      public) from the current rules page.
- [ ] Record on a clean run: fresh app launch, backend already running and
      confirmed healthy beforehand (don't debug live on camera).
- [ ] The video must show the real interactive product only: no claim of
      completed user testing, since none has been run yet (see
      `docs/USER_TEST_PROTOCOL.md`, which is the instrument for that, not
      a results report).

## 6. Written submission (Devpost project page text)

Not drafted as part of this checklist. These are the standard Devpost
fields to prepare separately when ready to submit: project
name/tagline, inspiration, what it does, how it was built, challenges,
accomplishments, what's next, and the built-with tag list (React Native,
Vega/Kepler, Python). The README's own "What it does" and "Scope and
limitations" sections are a solid source to draw from without having to
re-derive the description from scratch.

## 7. Eligibility and track

- [ ] Fire TV track: confirmed as the intended track throughout this
      project.
- [ ] **VERIFY** the hackathon's work-period window (what counts as "built
      during the hackathon") still matches when this project's actual work
      happened, and that team/eligibility info on the Devpost profile is
      complete.

## Decisions that need you, summarized

1. ~~**License**: pick one (or explicitly decide against one) for the
   `LICENSE` file.~~ Done: MIT, see `LICENSE` and README's "License"
   section.
2. **Repo visibility**: public vs. private-with-reviewer-access, and
   timing, per the current rules.
3. **Confirm the current rules page** hasn't changed anything else since
   12 October 2026; this checklist was written from that snapshot plus
   general Devpost submission conventions, not a fresh fetch of today's
   page.
