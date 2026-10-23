# Purpose

Write pick {{pick_id}}: a {{genre}} post.

## Variables

PICK: {{pick_id}}
GENRE: {{genre}}
SOURCES: {{sources}}
READER_NOTE: {{note}}

## Workflow

1. Call read_pick for PICK, then read every source in full with read_source.
2. Decide whether the pick can be written under the writing rules for GENRE. If not, stop and tell the reader why.
3. Call recent_layouts, choose the layout from the argmap rules, write the argmap JSON and call render_argmap until it reports no problems.
4. Write the post text and call save_draft with it and the image_id of the final render.

## Definition Of Done

- every source in SOURCES was read in full, or your reply says which one could not be read
- render_argmap reported no problems for the image you saved
- save_draft succeeded with no text problems
- your reply to the reader is in Chinese and under 120 words

## Report

In Chinese: the layout and why, the post's main judgment in one sentence, and anything you left out or could not verify.
