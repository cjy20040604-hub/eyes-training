# Testing VR on a headset

The VR path (WebXR) cannot be tested by the automated suites: there is no headset in CI.
The geometry, input mapping and the training-shell behaviour are unit- and component-tested
(`tests/unit/v3Modules.test.ts`, `tests/component/TrainingShellVr.test.tsx`), and the
end-to-end suite checks that without a headset VR stays off and sessions use the glasses.
Before calling a VR change done, run this checklist on a real headset.

## Setup

1. Open the live app in the headset browser (e.g. Quest Browser): the page must be served
   over https.
2. Calibrate on the computer screen first (the panel in VR keeps the same angular size and
   the same Δ offsets as the calibrated screen).
3. Settings → Renderer → `webxr`. The hint below must say a headset is available.

## Checklist

| Check                                                 | Expected                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start L1 for the first time                           | The VR comfort notice appears once, then the pre-session check                             |
| Pre-session check                                     | "VR session (beta): at most N minutes", N ≤ 10                                             |
| Enter VR                                              | Each eye sees only its own picture: the bird in the left eye, the cage in the right        |
| Look around                                           | The panel stays fixed in the room straight ahead; nothing moves with the head              |
| Prism offset                                          | With a 7Δ base-in calibration, the left eye's picture is shifted the same way as on screen |
| Controller trigger                                    | Works like Space (L1 chick, L2 confirm, L5 "can't tell")                                   |
| Thumbstick                                            | Moves the bird / ball; in L5 answers up / down / left / right                              |
| Grip (squeeze)                                        | STOP: VR ends and the page shows the STOP symptom check                                    |
| Micro-break                                           | The headset shows "Break — look into the distance" and the timer stops                     |
| Take the headset off / system button                  | The session pauses ("You left VR"); Resume, then Enter VR again                            |
| Hint line                                             | The current prompt and "Squeeze the grip to STOP" are readable at the bottom               |
| L3 / L4 / Brock / reading / video with `webxr` chosen | Notice that the module is not available in VR; it runs with the glasses                    |

Record the headset model, browser version and the results in the pull request.
