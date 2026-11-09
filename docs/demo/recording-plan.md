# Backup video plan

A live demo on venue Wi-Fi fails in ways rehearsal never shows. The backup video has to follow the runbook minute for minute, so we can cut to it at any point and pick up the same story.

- **When.** 5:00-5:30 PM, right after the second clean rehearsal, on the deployed stack.
- **What.** One take per runbook segment: overflow, stage AV, infrastructure, SLO, and Gitar. Recording them separately means a single failure only costs one retake.
- **Capture.**
  - Use QuickTime or OBS at 1920x1080, 30 fps.
  - Capture the projector window and the stage laptop.
  - Show the stage laptop's mic unplug on a phone camera, picture-in-picture.
- **Narration.** Read from the runbook, and say "count replay", "manual trigger", "caption fixture" and "assumed mapping" exactly where they apply.
- **On-screen labels.** Keep the board's fixture and rehearsal labels visible. Do not crop them out.
- **Hygiene.**
  - Enter all tokens before recording starts.
  - Keep terminals with secrets off screen.
  - Show no event logos.
  - Show no caption text other than the labelled fixture.
  - Keep private webcam frames out of shared recordings. The user-approved, credited HBO demo footage is allowed; retain its prerecorded/source labels.
- **Accessibility.** Export burned-in captions or an `.srt` file.
- **Files.** Save as `backstage-demo-<segment>-2026-11-09.mp4` in the team drive, not in this repo. Record each link and duration in `evidence/recording.md`.
- **Fallback cut.** Make one 5:00 edit with the infrastructure segment shortened to 15 s.

Open question: who holds the edit, and is there time for it before submission at 5:30?

## Thirty-second video and vision segment

Open `#/demo` on the site. The bundled 30-second silent conference edit loops with actual recorded YOLO boxes and zone counts. **Run YOLO live**, then **Play video**, sends sampled frames to the laptop-only detector for fresh inference. **Choose a local video** and **Use live camera** are alternate sources. Keep the page’s source and inference-mode labels visible.

The footage is HBO's Silicon Valley / TechCrunch Disrupt behind-the-scenes feature, three edited shots repeated to 30 seconds. Source/timecodes/model hash are in `apps/web/public/demo/source.json`. Recorded inference has 120 samples at 4Hz; it is detection playback, not a live event feed. Live inference on the bundled clip is still inference on prerecorded video. The public web image includes video and recorded results; the Python preview server is a separate laptop process.

Use this segment to explain perception, then open the incident board for the human approval and independent recovery workflow. Preview counts do not post signals and must not be described as proof of the calibrated 30-second trigger or 60-second recovery conditions. Stage mic/caption-monitor and inbox voice links retain their existing implementation limits.
