-- X ranks posts with outside links lower, so the source links leave the post: the draft's reply is the first reply,
-- posted under the post right after it goes out (the 原文 link block). The post text itself carries no links.
ALTER TABLE drafts ADD COLUMN reply TEXT;
