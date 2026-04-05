
-- 1. moderation_stopwords
CREATE TABLE public.moderation_stopwords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'block',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_stopwords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage stopwords"
  ON public.moderation_stopwords FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 2. moderation_events
CREATE TABLE public.moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  item_type text NOT NULL,
  item_id uuid,
  flagged_content text,
  matched_words text[],
  category text,
  result text NOT NULL DEFAULT 'cleared',
  tier text NOT NULL DEFAULT 'stopword',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view moderation events"
  ON public.moderation_events FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can insert own moderation events"
  ON public.moderation_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 3. user_suspensions
CREATE TABLE public.user_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  strike_count integer NOT NULL DEFAULT 0,
  suspended boolean NOT NULL DEFAULT false,
  suspended_at timestamptz,
  suspended_until timestamptz,
  suspension_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_suspensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own suspension"
  ON public.user_suspensions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert suspensions"
  ON public.user_suspensions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update suspensions"
  ON public.user_suspensions FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 4. moderation_review_queue
CREATE TABLE public.moderation_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  ai_category text,
  ai_confidence double precision,
  ai_reason text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.moderation_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own review queue items"
  ON public.moderation_review_queue FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view review queue"
  ON public.moderation_review_queue FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update review queue"
  ON public.moderation_review_queue FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 5. Seed stopwords
INSERT INTO public.moderation_stopwords (word, category, severity) VALUES
  -- sexual
  ('anal sex','sexual','block'),('blowjob','sexual','block'),('bondage','sexual','block'),('brothel','sexual','block'),
  ('camgirl','sexual','block'),('child porn','sexual','block'),('creampie','sexual','block'),('cumshot','sexual','block'),
  ('deepthroat','sexual','block'),('dildo','sexual','block'),('erotic','sexual','block'),('erotica','sexual','block'),
  ('escort service','sexual','block'),('fetish','sexual','block'),('gangbang','sexual','block'),('handjob','sexual','block'),
  ('hentai','sexual','block'),('lolicon','sexual','block'),('masturbat','sexual','block'),('milf','sexual','block'),
  ('naked','sexual','block'),('nude','sexual','block'),('nudes','sexual','block'),('onlyfans','sexual','block'),
  ('oral sex','sexual','block'),('orgasm','sexual','block'),('pedophil','sexual','block'),('porn','sexual','block'),
  ('pornography','sexual','block'),('prostitut','sexual','block'),('sex slave','sexual','block'),('sexting','sexual','block'),
  ('stripper','sexual','block'),('threesome','sexual','block'),('underage','sexual','block'),('vibrator','sexual','block'),
  ('xxx','sexual','block'),
  -- hate
  ('chink','hate','block'),('ethnic cleansing','hate','block'),('faggot','hate','block'),('gas the','hate','block'),
  ('genocide','hate','block'),('gook','hate','block'),('heil hitler','hate','block'),('kike','hate','block'),
  ('kill all','hate','block'),('nigga','hate','block'),('nigger','hate','block'),('raghead','hate','block'),
  ('retard','hate','block'),('sieg heil','hate','block'),('spic','hate','block'),('towelhead','hate','block'),
  ('tranny','hate','block'),('wetback','hate','block'),('white power','hate','block'),('white supremac','hate','block'),
  -- malware
  ('credential harvesting','malware','block'),('format c:','malware','block'),('keylogger','malware','block'),
  ('phishing','malware','block'),('ransomware','malware','block'),('reverse shell','malware','block'),
  ('rm -rf','malware','block'),('sql injection','malware','block'),('trojan horse','malware','block'),
  ('xss attack','malware','block'),
  -- spam
  ('buy now','spam','block'),('click here to win','spam','block'),('free money','spam','block'),
  ('make money fast','spam','block'),('nigerian prince','spam','block'),
  -- general
  ('predator','general','block');
