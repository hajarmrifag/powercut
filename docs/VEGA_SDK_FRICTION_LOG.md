# Vega SDK friction log

Issues actually hit while building and testing PowerCut, with the SDK/CLI
version, evidence, and the workaround used. This is not a bug report
against the SDK and makes no claim about current/upcoming releases: it's
a record for whoever continues this project, so the same friction isn't
rediscovered from scratch. Environment: Vega SDK/CLI 0.24.12112 (CLI
1.4.4), macOS 26.5, Apple Silicon (arm64), Node 26, npm 11, Python 3.14.

## 1. A build path containing a space breaks the release build

**Severity: high; blocks the build entirely, no flag or config fixes it.**

`react-native build-vega --build-type Release` invokes an internal
manifest-builder step with an unquoted shell path. Building from this
project's natural location (`~/Desktop/amazon hackathon/powercut-app`,
chosen by the user, not us) failed with:
```
/bin/sh: /Users/hajarmrifag/Desktop/amazon: No such file or directory
```
An otherwise-identical copy of the project at a no-space path (e.g.
`/private/tmp/powercut-app-build`) builds successfully. **Workaround**:
build from a path with no spaces; `rsync` the source there first if the
project itself must live somewhere with a space in the path. This is now
called out explicitly in this repo's README prerequisites. Not reported
upstream as part of this work.

## 2. The Virtual Device renders at roughly 2x the declared dp scale

**Severity: medium; silently produces an off-screen layout if not accounted for.**

A `View` sized `260×140` (React Native density-independent units) measured
roughly `520×280` physical pixels in a captured 1920×1080 screenshot, close
to exactly 2x, consistent with this device profile's `320x320` dpi
(`Setting display: 0 configuration to: 1920x1080, dpi: 320x320` in the
emulator's own boot log) against RN's 160dpi baseline. This was discovered
the hard way during Phase 2: an overview laid out assuming roughly 1:1
dp-to-px rendered its third row of content (the battery and action cards)
entirely below the visible 1080px viewport. The row was still mounted and
still received D-pad focus; nothing crashed, nothing errored; it was
simply invisible, confirmed by comparing a screenshot taken after
navigating onto it (no visible focus ring anywhere) against one taken
after a single step back (ring visible on the previous, on-screen card).
**Workaround**: measure actual rendered pixel dimensions against a known dp
value early, rather than assuming near-1:1 scaling from a desktop-oriented
mental model, and keep primary layouts to what fits in roughly half the
nominal dp dimensions of the target resolution.

## 3. The documented screenshot tools did not work; the emulator console did

**Severity: medium; affects development/debugging and evidence capture, not the shipped app.**

Across both the feasibility phase and this implementation, three
documented capture paths failed on this Virtual Device:
- `vda shell screenshooter <path>`: exit 137 (killed) with no screenshot
  produced.
- `vda shell automation-toolkit dump` (accessibility dump): exit 137.
- A QMP `screendump` via the emulator's raw socket: returned a black
  framebuffer, rejected as not representative of the actual rendered UI.

What worked consistently, used for every screenshot in this repository's
`evidence/` directory: connecting directly to the emulator console port
(`127.0.0.1:5554`), authenticating with the token at
`~/.emulator_console_auth_token`, and issuing `screenrecord screenshot
<dir>` over that raw socket. **Workaround**: a small Python helper
(`feasibility-powercut/platform/capture_console.py`, predating this repo)
wraps this; this repo's own captures reused the same technique inline.

## 4. The Virtual Device process exits when its launching process exits

**Severity: low-medium; affects scripted/automated testing workflows specifically.**

`vega virtual-device start --timeout 120` returns once the device is
ready, but the underlying emulator process is a child of that invocation:
if the terminal session or script that launched it exits, the device
appears to shut down shortly after ("Wait for emulator (pid N) 20 seconds
to shutdown gracefully before kill" in the instance's own log), even
though no explicit `stop` was issued. This is not necessarily wrong
behavior for an interactive CLI tool, but it is easy to hit by accident in
a scripted session. **Workaround**: a long-lived holder process
(`feasibility-powercut/platform/hold_vvd.py`, predating this repo) runs
`virtual-device start` and then blocks indefinitely so the launching
process never exits until the operator deliberately stops it.

## 5. A few CLI subcommands have non-obvious argument requirements

**Severity: low; quickly fixed once hit once.**

- `is-app-running` needs the app id passed as `--appName <id>`, not as a
  positional argument (a positional invocation fails rather than being
  accepted/corrected).
- `vega device doctor --directory <path>` requires an existing *absolute*
  path; a relative one is rejected.

Neither blocked anything once corrected; noted here only because they cost
real debugging time the first time.

## 6. The emulator console can record video, but not while taking D-pad input through the normal path

**Severity: medium; blocks a reasonable demo-recording workflow until worked around.**

The same emulator console used for screenshots (§3) also supports
`screenrecord start [--size|--bit-rate|--time-limit|--fps] <file>` and
`screenrecord stop`, producing a native VP9/Vorbis WebM at the device's
actual resolution (1920×1080 confirmed, no manual scaling needed):
this is the cleanest capture path found for this device, better than a
window-capture tool. Two real problems were hit using it:

- **A recording destination path containing a space fails** with
  `KO: Must specify output file`, the same class of bug as §1: the
  console command parser splits on the space. **Workaround**: record to
  a no-space path (e.g. `/private/tmp/...`) and copy the result into the
  project afterward, same as the existing build workaround.
- **While a `screenrecord` session is active, D-pad/Select input sent via
  `vda shell inputd-cli button_press` does not reach the app at all.**
  Confirmed by recording a full multi-step button sequence (open an
  appliance, change its hours, navigate to another screen) and finding
  the app's on-device state frozen at its starting point for the entire
  78-second take, verified against both the recorded video (checked at
  four different timestamps) and a live screenshot taken immediately
  after stopping the recording, which showed the same unchanged state.
  Re-running the identical `inputd-cli` sequence with no recording
  active worked immediately and correctly. The emulator console's
  lower-level raw input injection, `event send EV_KEY:<code>:1
  EV_KEY:<code>:0`, **does** move D-pad focus (arrow keys) while a
  recording is active, confirmed by recording a short clip, sending two
  `KEY_RIGHT` press/release pairs via `event send`, and finding focus
  correctly moved in the extracted frame. However, `event send` could
  **not** be made to trigger Select/Enter activation during a recording:
  `EV_KEY:KEY_ENTER`, `EV_KEY:KEY_SELECT`, `EV_KEY:KEY_OK`, and
  `EV_KEY:KEY_CENTER` were all accepted by the console (`OK` response)
  but none actually opened or activated anything on screen. **Workaround
  used for this project's demo video**: record each on-screen state as
  its own short clip with no input active during the recording; perform
  all state-changing button presses via the reliable `inputd-cli` path
  *between* recordings, with a console screenshot to verify each
  resulting state before the next clip starts; assemble the clips in
  post. This produces fully genuine, non-fabricated footage of every
  state, at the cost of not showing the literal keypress animation
  within a single continuous take.

## What did not turn out to be a Vega issue

Two things initially suspected of being SDK problems were not, on
investigation, caused by the SDK at all, and are recorded here only to
stop them being rediscovered as false leads:
- A `vega virtual-device status` failure reporting "No SDK installed or
  configured" was actually the Vega CLI's own Python tooling calling
  `os.getcwd()` from a working directory this process had temporarily lost
  OS-level read access to (an unrelated macOS permissions issue affecting
  the whole session, not the SDK): running the same command from an
  accessible directory succeeded immediately. Still worth noting as a
  **rough edge**: the CLI surfaces this as a generic "no SDK" message
  rather than the underlying `PermissionError`, which sent debugging in
  the wrong direction initially.
- The documented Homebrew prerequisite list (`binutils`, `coreutils`,
  `gawk`, `watchman`) could not be fully installed in this environment
  (SSL timeouts fetching GNU source tarballs for a from-source build on a
  non-standard Homebrew prefix): a local network/Homebrew-configuration
  issue, not a Vega SDK defect, and it did not end up blocking any of the
  gates actually exercised (release build, Virtual Device run, host HTTP
  access).
