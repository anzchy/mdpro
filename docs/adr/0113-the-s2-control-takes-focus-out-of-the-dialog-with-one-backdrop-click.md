# 0113. The S2 control takes focus out of the dialog with one backdrop click before the Esc

## Status

Accepted, 2026-10-16. Decided by the user, who chose 「1. Click backdrop, then Esc (Recommended)」
(relayed by mdpro-delegator), and told adr047-verify 「The redesign decision: Option 1」. The options
were put by adr047-verify after the WI-005 sitting; ADR-0113 was reserved by mdpro-delegator.

Supersedes, for S2 only:
- the clause of [ADR-0047](0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)
  decision 4 "without first focusing the dialog";
- [ADR-0100](0100-the-s2-negative-control-is-a-minimal-confirmdialog-patch.md) decision 3 where it
  sets the baseline's human part to "J5 step 3 on both builds" as J5 then stood.

The control build itself, ADR-0100's patch, is unchanged.

Partially superseded, 2026-10-17: the decision's "What re-runs. The physical Esc is re-taken …" and
the consequence "The physical class still applies to the Esc alone", for the spike's S2 runs only
(the 2026-10-16 control and both candidates' S2.1), by
[ADR-0117](0117-a-relayed-remote-key-stands-for-the-physical-esc-in-the-spikes-s2-runs.md).

## Context

On 2026-10-16 the S2 negative control did not hold (spike record, "Negative control (WI-005)"). One
physical Esc closed "Unsaved changes" on the control build as well as on the head build, so S2 was
void (ADR-0047 decision 4).

The cause is where focus is when the key arrives:
- `ConfirmDialog` puts focus on **Keep editing**, inside the card, when it opens.
- The control build's restored pre-D34 listener sits on the backdrop element. It fires whenever
  focus is inside it.

This was not new before D34 either. The confirm button had `autoFocus`
(`git show c39dfb12^:src/components/common/ConfirmDialog.tsx`). What D34 fixed was an Esc with
focus **outside** the dialog; the reproducers CD-1 and CD-2 put it on `<body>` and in an outside
textbox. J5 as written ("nothing is focused, clicked or tabbed to first") never reaches that state,
so on it the two builds cannot differ.

The patch is not at fault. The protocol is. In `ConfirmDialog.tsx` at `9940be9`, the backdrop
`div.dialog-backdrop` has no click handler, so a click on it cancels nothing.

## Options considered

1. **One click on the dimmed backdrop, outside the card, then the Esc** (chosen).
   - It is how a person meets D34: click outside the dialog, then press Esc.
   - It needs no script, and the physical and driver runs start from the same state.
   - It rests on one unverified fact: that in WebKit the click takes focus off the button. A probe
     on the control build checks that before any sitting.
2. **A scripted `document.activeElement.blur()` from the inspector console before the Esc.**
   - Kept as the fallback if the probe shows the click does not move focus.
   - It lost first place because a script touches the page before the key under test.
   - Closing the docked inspector afterwards may move focus again.
3. **Keep the protocol and judge by log path.** The control build logs one line (`ui.dialog.cancel`),
   the head build two.
   - Rejected. With focus inside the card, any key, driver or physical, reaches the focused
     element. A path difference cannot show whether a driver's Esc behaves like a person's when
     focus is elsewhere, which is what S2 asks.
4. **Drop S2 from the spike gate** and select on S1 and S3–S5.
   - Rejected. It changes ADR-0047 decision 4 itself.
   - The keyboard question is the reason the spike has a physical evidence class.
   - The next dialog-focus defect would go untested by the driver.

## Decision

- **J5 gets a step 2a for S2 runs.** One left click on the dimmed backdrop, inside the window,
  outside the card, at least 40 px from the card's edge and from the window's edge. It is done by
  computer use, on every bundle, in every S2 run, physical and driver alike.
  - Nothing else is clicked, focused or tabbed to before the Esc.
  - ADR-0047's "without first focusing the dialog" now reads "after step 2a and nothing else; no
    focus is placed inside the dialog".
- **The run counts only if focus was outside the card at the key.** The recorder's Escape entry must
  show `inDialog:false` and `active:"BODY."`: focus on `<body>`, the CD-1 state, and so outside
  the backdrop the control's listener sits on.
  - Otherwise the run is not exercised. It is not a pass and not a fail.
- **The click must cancel nothing.** If it closes the dialog or writes a `ui.dialog.*` line, the run
  stops and the protocol goes back to the user.
- **The probe goes first.** Before the sitting, dtrack (no user) opens the dialog on the control
  build, clicks the backdrop and reads DOM focus.
  - If focus stays inside the card, option 2 replaces step 2a.
  - The spike record says which applies; the decision stands either way.
- **Ways back to the window.** If the window loses focus while the person reads the chat, they bring
  it back with **⌘-Tab or its Dock icon**, never a click inside the window. Neither sends an event
  into the page.
  - The 2026-10-16 Dock clicks were ruled the same way.
- **What re-runs.** The physical Esc is re-taken under this protocol on the control and head
  baselines and on both candidate A bundles (S2.1). Then the driver runs S2.2 and S2.3. No bundle
  is rebuilt.
  - 2026-10-16's P1 stays in the record as a D34 check with focus inside the card. It does not
    count as the control.
  - Comparisons one and two are not re-run.

## Consequences

- The control now tests the state D34 was about, focus outside the dialog. On the head build Esc
  still goes through the document-level capture stack (ADR-0045).
- S2 no longer tests an Esc with focus on Keep editing. That case cannot tell the two builds apart,
  and 2026-10-16's P1 already recorded it on both.
- Step 2a is a mouse click by computer use, which is `driver-free computer-use input`, the class
  WI-004 accepted. It is not a person's hand, and the record names it as such. The physical class
  still applies to the Esc alone.
- The protocol now depends on a WebKit focus fact checked by a probe, not by source reading. A
  WebKit update could change it, so a later S2 re-run (the re-verification after selection) re-reads
  the recorder entry rather than assuming it.
- One more sitting is needed: about 20 min of wall time, about 8 of the user's (four Esc presses),
  then about 10 min of dtrack alone.
