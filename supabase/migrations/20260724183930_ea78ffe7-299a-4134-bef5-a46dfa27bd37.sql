CREATE OR REPLACE FUNCTION public.profile_fact_token_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH cleaned AS (
    SELECT lower(coalesce(t, '')) AS s
  ), apostrophes_removed AS (
    SELECT regexp_replace(s, '[''’‘´`]', '', 'g') AS s
    FROM cleaned
  ), words_only AS (
    SELECT btrim(regexp_replace(regexp_replace(s, '[^[:alnum:]]+', ' ', 'g'), '\s+', ' ', 'g')) AS s
    FROM apostrophes_removed
  ), phrase_normalized AS (
    SELECT regexp_replace(
             regexp_replace(s, '(^| )mcdonald s( |$)', ' mcdonalds ', 'g'),
             '(^| )domino s( |$)', ' dominos ', 'g'
           ) AS s
    FROM words_only
  ), stopwords_removed AS (
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(s, '(^| )(specifically|especially|favorite|favourite|anything|something|things|thing|also|all|chapters?)( |$)', ' ', 'g'),
                   '(^| )(from|in|at|of|to|for|with|as|the|a|an)( |$)', ' ', 'g'
                 ),
                 '(^| )(specifically|especially|favorite|favourite|anything|something|things|thing|also|all|chapters?)( |$)', ' ', 'g'
               ),
               '(^| )(from|in|at|of|to|for|with|as|the|a|an)( |$)', ' ', 'g'
             ),
             '\s+', ' ', 'g'
           ) AS s
    FROM phrase_normalized
  )
  SELECT btrim(s)
  FROM stopwords_removed;
$$;

SELECT public.cleanup_profile_token_duplicates();