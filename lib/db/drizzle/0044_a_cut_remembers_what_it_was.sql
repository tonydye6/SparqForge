-- 0044 · a cut remembers what it was.
--
-- Build step 3 renders the cut. Step 4's question — "is this rendered file
-- still what the post says?" — has to be answerable without re-rendering to
-- find out, and no timestamp can answer it: reordering shots changes no
-- createdAt, and re-picking the still upstream changes no sequence row at all.
--
-- So the render stamps what it consumed. The fingerprint covers every clip's
-- source, trim and transition in order, and every track's audio, level and
-- duck. The read model recomputes it and compares: equal means the file on
-- disk IS the cut; different means STALE, said in the same language as every
-- other stage. Nothing re-renders itself.

ALTER TABLE "sequences" ADD COLUMN "render_fingerprint" text;
