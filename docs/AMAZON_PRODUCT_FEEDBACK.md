# Amazon/Vega product feedback (for the hackathon's sponsor-tech feedback field, if one exists)

This is feedback on the Vega SDK/CLI itself, derived from
`docs/VEGA_SDK_FRICTION_LOG.md`, written for whoever reads a hackathon
feedback form field. It is not a bug report filed upstream, and it makes
no claim about current or upcoming SDK releases — just what was actually
hit while building PowerCut. Environment: Vega SDK/CLI 0.24.12112 (CLI
1.4.4), macOS 26.5, Apple Silicon (arm64), Node 26, npm 11, Python 3.14.

**Check the submission form before using this** — `AMAZONAPPDEV2026
rules page` (`amazonappdev2026.devpost.com/rules`) may or may not have a
dedicated sponsor-feedback field; this document is written to be
reusable as a direct paste or as source material either way, not
submitted anywhere itself yet.

## If there's room for only three things

1. **Unquoted shell paths break on spaces, in two different places** —
   the release build (`react-native build-vega`) and the emulator
   console's `screenrecord` file argument both fail outright on a path
   containing a space, with no flag to work around it other than moving
   the whole project. A default macOS username's home directory
   (`~/Desktop`) doesn't usually have spaces, but a reasonably-named
   project folder ("amazon hackathon") does — this cost real time twice
   for exactly the same underlying reason.
2. **The documented screenshot/accessibility-dump tools
   (`screenshooter`, `automation-toolkit dump`) don't work on this
   Virtual Device profile** — both exit 137 with nothing produced. The
   emulator console's own `screenrecord screenshot`/`screenrecord
   start`/`event send` commands, which aren't the documented path, are
   what actually worked for every screenshot and the demo video in this
   project.
3. **D-pad/Select input and active screen recording don't coexist
   cleanly.** Button presses sent through the normal input path
   (`vda shell inputd-cli button_press`) are silently dropped while a
   `screenrecord` session is active — confirmed by a frozen 78-second
   recording that didn't match a quick live-screenshot check of the
   same moment. A lower-level raw input path (`event send
   EV_KEY:...`) does work for D-pad movement during a recording, but
   not for Select/Enter activation through any keycode tried. This
   makes a single continuous take of a real interactive flow
   essentially unachievable right now; a multi-clip workaround (record
   each state, change state between recordings, assemble in post) was
   used instead, documented in `docs/DEMO_VIDEO_STORYBOARD.md`.

## Everything else that cost real time

See `docs/VEGA_SDK_FRICTION_LOG.md` in full — it covers the ~2x
dp-to-pixel scaling on this device profile (a view laid out for roughly
1:1 scaling silently renders off-screen, with no crash or error), the
Virtual Device process exiting when its launching shell exits, and a
couple of CLI argument quirks (`is-app-running --appName`, requiring
absolute paths for `device doctor --directory`). Two things that looked
like SDK bugs turned out not to be (a misleading "no SDK" error that was
actually a local permissions issue, and a Homebrew prerequisite that
couldn't fully install due to local network conditions) — both are
recorded in the friction log's "what did not turn out to be a Vega
issue" section so they aren't mistaken for SDK defects by anyone reading
this.

## What worked well, for balance

The actual app-development loop — React Native + TVFocusGuideView +
`useKeplerBackHandler` for D-pad navigation, `vega run-app` for
install+launch, the Virtual Device itself once running — was
straightforward and didn't need further workarounds beyond the items
above. The emulator console, while undocumented as the primary capture
path, turned out to be a reliable, scriptable way to get both stills and
video once its auth/connection pattern was worked out once.
