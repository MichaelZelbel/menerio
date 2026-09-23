-- Release profile normalization jobs that hit the attempt cap by succeeding.
--
-- `admin-normalize` claims only jobs with attempts < 5 and adds one per claim.
-- Nothing ever reset the counter: a completed job kept it, and
-- enqueue_profile_normalization_job re-queues without touching it. So every
-- subject stopped being normalized from the queue after its fifth run, however
-- many of those runs succeeded. The function now resets attempts on success;
-- this clears the jobs already stranded that way. A job whose last run failed
-- still carries last_error and keeps its count.
UPDATE public.profile_normalization_jobs
   SET attempts = 0, updated_at = now()
 WHERE status = 'queued'
   AND attempts >= 5
   AND last_error IS NULL;
