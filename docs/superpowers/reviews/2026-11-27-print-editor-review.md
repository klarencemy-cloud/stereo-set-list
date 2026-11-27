# Print editor: review findings to fix

Review of branch `feat/print-editor` against `main`, 2026-11-27. It covers the commit `202fce0` (the print editor)
and the work not yet committed then: the A− [size ▾] A+ control on both sheets, the clean-up of nested size spans,
and the dark-mode colours for the size list.

Two reviews ran: one against the repo's coding standards, one against the agreed design (below). None of these
findings is fixed yet. Several are unconfirmed: the tests run in jsdom, which has no `execCommand`, so the
floor sheet's styling can only be checked in a real browser. **Reproduce each one first, as CLAUDE.md asks**,
before fixing it.

Files: `src/app/components/PrintEditor.tsx`, `src/app/components/richText.ts`, `src/shared/print.ts`,
`src/app/pages/GigPage.tsx`, `src/app/styles.css` (print editor section).

## The agreed design (for checking fixes against)

- Print setlist and Print lyrics open the **Print editor**. Print lyrics asks Lyrics + chords / Lyrics only first,
  with no Cancel button: pressing Print lyrics again closes the choice.
- White A4 pages, scaled to fit on phones. Close / Download PDF / Print at the top.
- **Floor sheet:** words editable, starts as before (titles in capitals). On selected words: font, A− [size ▾] A+,
  bold, italic, underline, Left / Centre / Right. Select all, Reset.
- **Lyrics + chords sheet:** words editable. Only A− [size ▾] A+ (10–28pt, 2pt steps, starts at 14pt), Lyrics font
  (fixed-width fonts only), Reset. No other tools, title included.
- **Lyrics only sheet:** the same size control, Lyrics font (any font), Reset. Nothing else.
- On a gig's lyric sheets, size and font change only the song you're working on.
- A chord line and its lyric wrap together at the same word.
- Nothing is saved to the song or gig, and nothing is remembered between prints.
- Close asks Keep editing / Throw away only if something changed. The editor stays open after Print or Download PDF.
- Download PDF opens the print window and says to pick "Save as PDF".
- File names: "‹Gig name› – Floor sheet", "‹Gig name› – Lyric sheets", "‹Song title› – Lyric sheet".
- Left out on purpose: colour, a page-break line, alignment on lyric sheets.

## Bugs

- [ ] **1. A+ may undo a font you picked (floor sheet). Unconfirmed.**
  Size reuses the font trick in `wrapSelection` (`richText.ts`): it marks the selection with
  `execCommand("fontName", "pe-mark")`. Browsers may strip any `font-family` already inside the selection when they
  do that.
  *Try:* select a title, pick Impact, press A+. If the title goes back to Arial Black, it's real.
  *Fix idea:* mark sizes with `execCommand("fontSize", false, "7")` and look for `font[size="7"]` instead, so the
  size marker never touches the font.

- [ ] **2. Repeated A+ can leave empty spans behind. Unconfirmed.**
  The clean-up loop in `wrapSelection` only handles the new span landing *inside* the old one. On a repeat A+ the
  kept selection runs from before the old span to after it, so the browser may put the new `<font>` *outside* it.
  Clearing the inner style then leaves an empty `<span style="">`, one more per press. Nothing shows on screen.
  The loop also unwraps any span whose style ends up empty, even one with a class (from pasted text, say).
  *Try:* select a title, press A+ five times, then look at that line's HTML.
  *Fix idea:* after wrapping, also remove `span` elements with no attributes inside the new span. Only unwrap
  spans that have no attributes other than `style`.

- [ ] **3. Styling still applies to words that no longer look selected.**
  `useKeptSelection` ignores selections outside the sheet and never forgets the last one.
  *Try:* select a title, click the grey area beside the page, press Bold. The title turns bold, and the size list
  still shows its size.
  *Fix idea:* when the selection moves outside the sheet, onto anything other than the toolbar, clear the kept
  range and set the size back to `null`. Watch out: tapping a toolbar button or the size list must keep it.

- [ ] **4. The size list can show the wrong size.**
  `sizeAt` reads the size where the selection starts. That can be the end of the line above (a different size),
  and with mixed sizes selected it shows only the first one.
  *Fix idea:* if the start is at the end of a text node, move to the next text node. Optionally show "Size"
  (no number) when the selected words have more than one size.

- [ ] **5. A− and A+ look usable when nothing is selected, but do nothing (floor sheet).**
  In `SizeControl`, `disabled` is only set when there's no smaller or bigger size, not when `value` is `null`.
  *Fix:* disable both buttons when `value === null`.

- [ ] **6. A+ on a phone sizes the wrong song (gig lyric sheets).**
  "The song you're working on" (`active` in `LyricSheets`) starts as song 1 and only changes when you tap a page.
  *Try:* on a 15-song gig, scroll to song 6 and press A+ without tapping. Song 1 grows off-screen, and nothing
  you can see changes.
  *Fix idea:* make the song mostly on screen the active one as you scroll, using an `IntersectionObserver` on the
  pages. Keep the "Changing: ‹title›" label, so it's always clear which song the tools change.

- [ ] **7. Keyboard shortcuts and paste get round "no other tools".**
  Each lyric sheet is a plain `contentEditable`. Ctrl+B / Ctrl+I / Ctrl+U still bold, italicise and underline the
  lyrics and the title. Pasting from a web page or a document keeps its font, size, colour and highlight. On the
  floor sheet, that brings in colour, which was left out on purpose.
  *Fix idea:* on lyric sheets, block `formatBold` / `formatItalic` / `formatUnderline` in `onBeforeInput` (and the
  Ctrl+B/I/U keys). On both sheets, paste as plain text: in `onPaste`, `preventDefault()` and insert
  `clipboardData.getData("text/plain")`.

- [ ] **8. Long runs without spaces can run off the page (Lyrics + chords).**
  Each chord-and-lyric piece is `white-space: pre` inside `inline-flex`, so it never breaks inside. At 28pt a URL,
  a run of dashes, or a piece with chords close together can be wider than the page, and print cut off.
  *Fix idea:* give `.pe-seg` a `max-width: 100%` and let a piece that is still too wide break
  (`white-space: pre-wrap; overflow-wrap: anywhere`) as a last resort.

- [ ] **9. Ctrl+P with the editor open gives the PDF the wrong name.**
  The right pages print, but `document.title` is only set by the editor's own Print and Download PDF buttons.
  *Fix idea:* set the title on `beforeprint` while the editor is open (and put it back on `afterprint`), instead
  of only in the buttons.

## Not in the agreed design: decide whether to keep

- [ ] **Lyrics-only fonts are a fixed list of 7.** The design says "any font". It leaves out Arial Black and Impact,
  which the floor sheet offers. Add them, or agree the list is enough.
- [ ] **Reset on a gig resets only the song you're on.** Edits to other songs stay, so Close still asks. Decide if
  that's right, or if a "Reset all" is wanted.
- [ ] **Escape closes the editor** (asking first if something changed). Not asked for.
- [ ] **"Changing: ‹title›" and the yellow outline** on the song you're working on. Not asked for, but they back up
  "only the song you're working on".
- [ ] **The size list adds sizes that aren't in it** (from pasted text, say), so the list can show them.

## Tidy-ups (judgement calls)

- [ ] **Shown size when unknown:** when the browser can't tell the size, the list shows 34
  (`sizeAt(range) ?? FLOOR_START`). That leans against CLAUDE.md's "Don't invent placeholder data"; show "Size"
  instead.
- [ ] **34pt in three places:** the floor sheet's starting size is in `FLOOR_START`, in `.pe-floor` and in
  `.print-setlist`. `GigPage.tsx` also builds the upper-case titles twice (once for the editor, once for the
  Ctrl+P sheet). Keep one of each.
- [ ] **Two kinds that can disagree:** `PrintJob.kind` and `PrintFile.kind` must agree, but the types allow
  `{ kind: "floor", file: { kind: "songLyrics" } }`. Work out the file name from the job instead.
- [ ] **Alignment written two ways:** a chain of conditions in `applyStyle` and the `SHORT_START` map in
  `PrintEditor.tsx`. Use one map for both.
- [ ] **Vague names:** `heard` (the `onSelect` ref), `fresh`, `tool`, `Look`.
- [ ] **A− and A+ written two ways:** `{"A−"}` and plain `A+` in the JSX. Use one style.

## Check on a real phone

- [ ] **iPhone editing:** pages are shrunk with CSS `zoom` while you edit them. iPhone Safari has had bugs placing the
  cursor and selection in zoomed text. Try selecting and typing on an iPhone.
- [ ] **Printing:** Print and Download PDF, on a computer and on a phone. Check the PDF's file name and that only
  the pages print.
