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
   READER_NOTE is what the reader asked for in this post (none means nothing). Follow it, unless it would break the sources' facts or the writing rules: then keep to those and say which part you did not follow.
3. Call recent_layouts, choose the layout from the argmap rules, write the argmap JSON and call render_argmap until it reports no problems.
4. Write the post text and its first reply (the 原文 links), and call save_draft with both and the image_id of the final render.

## Definition Of Done

- every source in SOURCES was read in full, or your reply says which one could not be read
- render_argmap reported no problems for the image you saved
- save_draft succeeded with no text problems
- READER_NOTE was followed, or your reply names the part you did not follow and why
- your reply to the reader is in Chinese and under 120 words

## Report

In Chinese: the layout and why, the post's main judgment in one sentence, and anything you left out or could not verify.
