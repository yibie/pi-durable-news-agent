# lieflat-less-ai-tone (vendored)

The writer's 去 AI 味 check uses 「去AI味 v2」 by shiujan: https://github.com/larashero3-dotcom/lieflat-less-ai-tone
(commit fe13f1a), licensed CC BY-NC 4.0 (see LICENSE; commercial use needs the author's permission). Used here for
personal, non-commercial writing.

Copied unchanged: SKILL.md, DETECT.md, references/semantic-criteria.md, LICENSE.

Changed: scripts/detect.py takes `--short`. Without it the script refuses texts under 500 Chinese characters; with it
the script still reports the locatable hits and marks `meta.short = true`, because X posts are often that short and the
per-thousand-character densities are unreliable there. Nothing else in the script is changed.

Not copied: README, RESEARCH, examples, assets, and scripts/report.py, check-structure.py, check-translationese.py,
compare-human-ai.py. The writer reports the before/after counts itself from two runs of detect.py.
