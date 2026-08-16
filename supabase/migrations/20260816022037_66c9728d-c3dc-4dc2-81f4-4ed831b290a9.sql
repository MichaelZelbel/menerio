CREATE OR REPLACE FUNCTION public.profile_label_norm_key(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_tokens text[];
    v_out text[] := ARRAY[]::text[];
    v_tok text;
    v_drop text[] := ARRAY['the','a','an','of','for','at','in','on','to','and','my','his','her','their','our','its',
                           'current','currently','present','other','another','additional','second','secondary',
                           'alternate','alternative','extra','side','further','more','general','misc','miscellaneous',
                           'info','information','detail','details','personal'];
BEGIN
    IF t IS NULL THEN RETURN ''; END IF;

    v_tokens := regexp_split_to_array(
        trim(regexp_replace(lower(t), '[^a-z0-9äöüß]+', ' ', 'g')),
        '\s+'
    );

    FOREACH v_tok IN ARRAY COALESCE(v_tokens, ARRAY[]::text[]) LOOP
        IF v_tok IS NULL OR length(v_tok) = 0 THEN CONTINUE; END IF;
        IF v_tok = ANY(v_drop) THEN CONTINUE; END IF;

        -- synonym folding first (so words like "alias" survive intact)
        v_tok := CASE v_tok
            WHEN 'job' THEN 'occupation'
            WHEN 'jobs' THEN 'occupation'
            WHEN 'work' THEN 'occupation'
            WHEN 'profession' THEN 'occupation'
            WHEN 'employment' THEN 'occupation'
            WHEN 'career' THEN 'occupation'
            WHEN 'gig' THEN 'occupation'
            WHEN 'company' THEN 'employer'
            WHEN 'firm' THEN 'employer'
            WHEN 'organisation' THEN 'employer'
            WHEN 'organization' THEN 'employer'
            WHEN 'workplace' THEN 'employer'
            WHEN 'town' THEN 'city'
            WHEN 'residence' THEN 'city'
            WHEN 'mobile' THEN 'phone'
            WHEN 'cell' THEN 'phone'
            WHEN 'cellphone' THEN 'phone'
            WHEN 'telephone' THEN 'phone'
            WHEN 'mail' THEN 'email'
            WHEN 'hobby' THEN 'interest'
            WHEN 'hobbies' THEN 'interest'
            WHEN 'pastime' THEN 'interest'
            WHEN 'expertise' THEN 'skill'
            WHEN 'competency' THEN 'skill'
            WHEN 'competence' THEN 'skill'
            WHEN 'former' THEN 'previous'
            WHEN 'ex' THEN 'previous'
            WHEN 'prior' THEN 'previous'
            WHEN 'past' THEN 'previous'
            WHEN 'earlier' THEN 'previous'
            WHEN 'alias' THEN 'nickname'
            WHEN 'aliases' THEN 'nickname'
            WHEN 'aka' THEN 'nickname'
            WHEN 'moniker' THEN 'nickname'
            WHEN 'title' THEN 'role'
            WHEN 'position' THEN 'role'
            WHEN 'designation' THEN 'role'
            WHEN 'favourite' THEN 'favorite'
            WHEN 'favourites' THEN 'favorite'
            WHEN 'preferred' THEN 'favorite'
            WHEN 'beloved' THEN 'favorite'
            WHEN 'dish' THEN 'food'
            WHEN 'dishes' THEN 'food'
            WHEN 'cuisine' THEN 'food'
            WHEN 'meal' THEN 'food'
            WHEN 'beverage' THEN 'drink'
            WHEN 'kid' THEN 'child'
            WHEN 'children' THEN 'child'
            WHEN 'tongue' THEN 'language'
            WHEN 'birthday' THEN 'birth'
            WHEN 'dob' THEN 'birth'
            ELSE v_tok
        END;

        -- naive singularization, skipping endings where it would corrupt the word
        IF length(v_tok) > 4 AND v_tok LIKE '%ies' THEN
            v_tok := left(v_tok, length(v_tok) - 3) || 'y';
        ELSIF length(v_tok) > 3 AND v_tok LIKE '%s'
              AND v_tok NOT LIKE '%ss' AND v_tok NOT LIKE '%us'
              AND v_tok NOT LIKE '%as' AND v_tok NOT LIKE '%is' AND v_tok NOT LIKE '%os' THEN
            v_tok := left(v_tok, length(v_tok) - 1);
        END IF;

        IF NOT (v_tok = ANY(v_out)) THEN
            v_out := array_append(v_out, v_tok);
        END IF;
    END LOOP;

    SELECT array_agg(x ORDER BY x) INTO v_out FROM unnest(v_out) AS x;
    RETURN COALESCE(array_to_string(v_out, ' '), '');
END;
$$;