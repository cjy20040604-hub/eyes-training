# Accessibility

## What is checked automatically

`tests/e2e/a11y.spec.ts` runs on every push (CI):

- **WCAG 2.1 A/AA scan with axe-core** of every page: disclaimer, overview (empty and with
  data), quick start, calibration, history, report, settings, a module page, the
  pre-session check, the running training screen and the weekly self-check.
- **Keyboard:** the first Tab reaches "Skip to main content", which moves focus to the main
  region; focus is visibly outlined; Escape is STOP on the training screen; the problem-report
  dialog is modal, takes focus on its first field and closes with Escape.

## Design rules

- Every control is a real `button`, `a`, `input` or `select` with a visible label; groups
  of options (`Segmented`) are buttons with `aria-pressed` inside a labelled group.
- Progress bars have an accessible name (`Progress` requires `label`).
- Prompts during training are announced (`aria-live="polite"`); overlays use
  `role="dialog"` / `role="alertdialog"`.
- The STOP button is black on white with a text label, readable through either filter
  and without colour.
- Reduced motion: the system setting (or Settings) slows moving stimuli.
- Interface colours never carry meaning alone (icons and text accompany tones); chart colours
  were checked for colour-vision deficiency in light and dark mode.

## Limits

- **The training picture is visual by nature.** Each canvas has a text alternative, the task
  prompt is announced, and every input works from the keyboard, but the exercises themselves
  need sight in both eyes.
- **Colour vision and red/cyan glasses.** The glasses separate the eyes by optical filter, so
  colour-vision deficiency does not stop the separation. With protan (red) deficiency the eye
  behind the red filter sees a darker picture; with deutan deficiency the cyan side can look
  slightly dimmer. The calibration's contrast-balance step measures and compensates the
  brightness difference, and the glasses step says so. This has been reasoned through, not
  tested with colour-deficient users; feedback is welcome.
- Not yet tested with a real screen reader user (only automated checks and keyboard tests).
