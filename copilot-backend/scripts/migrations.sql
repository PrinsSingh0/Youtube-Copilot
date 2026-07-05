-- =====================================================================
-- 3.1. CORE SCHEMAS, ENUMS, & TYPE DEFINITIONS
-- =====================================================================
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stripe_billing_status') THEN
        CREATE TYPE stripe_billing_status AS ENUM ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'inactive');
    END IF;
END $$;

-- =====================================================================
-- 3.2. PRODUCTION SYSTEM DATA TABLES
-- =====================================================================

-- Table A: Core Monetization Profile Indices
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_status stripe_billing_status DEFAULT 'inactive' NOT NULL,
    current_streak INT DEFAULT 0 NOT NULL,
    max_streak INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Upgrade path for existing users table:
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0 NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS max_streak INT DEFAULT 0 NOT NULL;

-- Table B: Real-Time Audio Dictation Tracking Ledger
CREATE TABLE IF NOT EXISTS public.usage_ledger (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    daily_minutes_used INT DEFAULT 0 NOT NULL CONSTRAINT max_limit_guard CHECK (daily_minutes_used >= 0),
    last_active_date DATE DEFAULT CURRENT_DATE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Table C: Cryptographically Encrypted Personal Workspace Tokens
CREATE TABLE IF NOT EXISTS public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    platform_name TEXT NOT NULL CHECK (platform_name IN ('notion', 'github', 'google_docs', 'coda', 'craft', 'anytype', 'appflowy', 'slite')),
    encrypted_access_token TEXT NOT NULL,
    encryption_iv TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_user_platform UNIQUE (user_id, platform_name)
);

-- Table D: Learning Telemetry Metrics Ledger
CREATE TABLE IF NOT EXISTS public.learning_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    topic_tag TEXT NOT NULL,
    export_destination TEXT NOT NULL,
    video_id TEXT NOT NULL,
    video_title TEXT NOT NULL,
    platform_origin TEXT NOT NULL, -- 'youtube', 'udemy', 'coursera', etc.
    time_spent_seconds INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Table E: Spaced Repetition Flashcard Memory Registry (SM-2 Ledger)
CREATE TABLE IF NOT EXISTS public.spaced_repetition_cards (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    topic_tag TEXT NOT NULL,
    video_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    solution_text TEXT NOT NULL,
    repetitions INT DEFAULT 0 NOT NULL,
    ease_factor NUMERIC(4,2) DEFAULT 2.50 NOT NULL,
    review_interval_days INT DEFAULT 0 NOT NULL,
    next_review_date DATE DEFAULT CURRENT_DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- =====================================================================
-- 3.3. TRANSACTIONAL PERFORMANCE SEARCH INDEXES (Non-Concurrent for Multi-Statement safety)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_users_status_lookup    ON public.users (id, stripe_subscription_status);
CREATE INDEX IF NOT EXISTS idx_ledger_heartbeat_speed ON public.usage_ledger (user_id, last_active_date);
CREATE INDEX IF NOT EXISTS idx_integrations_pkm_route ON public.user_integrations (user_id, platform_name);
CREATE INDEX IF NOT EXISTS idx_events_dashboard_data  ON public.learning_events (user_id, topic_tag, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_scheduler_queue  ON public.spaced_repetition_cards (user_id, next_review_date);

-- =====================================================================
-- 3.4. AUTOMATION TRIGGERS & PL/pgSQL PROCEDURAL ENGINES
-- =====================================================================

-- Auto-provision entries immediately when a user signs in with Google Auth
CREATE OR REPLACE FUNCTION public.handle_new_user_provisioning()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, trial_start_date, stripe_subscription_status)
    VALUES (NEW.id, NEW.email, CURRENT_TIMESTAMP, 'inactive')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.usage_ledger (user_id, daily_minutes_used, last_active_date)
    VALUES (NEW.id, 0, CURRENT_DATE)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_provisioning();

-- Centralized Automated Streak Calculator Function
CREATE OR REPLACE FUNCTION log_event_and_calculate_streak(
    target_user_id UUID,
    target_topic TEXT,
    target_destination TEXT,
    target_video_id TEXT,
    target_video_title TEXT,
    target_platform TEXT,
    seconds_watched INT
)
RETURNS VOID AS $$
DECLARE
    last_event_date DATE;
BEGIN
    -- 1. Insert the raw learning telemetry row
    INSERT INTO public.learning_events (user_id, topic_tag, export_destination, video_id, video_title, platform_origin, time_spent_seconds)
    VALUES (target_user_id, target_topic, target_destination, target_video_id, target_video_title, target_platform, seconds_watched);

    -- 2. Extract the user's latest historical activity milestone
    SELECT MAX(created_at::DATE) INTO last_event_date 
    FROM public.learning_events 
    WHERE user_id = target_user_id AND created_at::DATE < CURRENT_DATE;

    -- 3. Run evaluation branches
    IF last_event_date IS NULL THEN
        UPDATE public.users SET current_streak = 1, max_streak = GREATEST(max_streak, 1) WHERE id = target_user_id;
    ELSIF last_event_date = CURRENT_DATE - INTERVAL '1 day' THEN
        UPDATE public.users 
        SET current_streak = current_streak + 1, max_streak = GREATEST(max_streak, current_streak + 1) 
        WHERE id = target_user_id;
    ELSIF last_event_date < CURRENT_DATE - INTERVAL '1 day' THEN
        UPDATE public.users SET current_streak = 1 WHERE id = target_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Universal Updated_At Timestamp Synchronizer
CREATE OR REPLACE FUNCTION update_modification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_users_time BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_modification_timestamp();
CREATE TRIGGER sync_ledger_time BEFORE UPDATE ON public.usage_ledger FOR EACH ROW EXECUTE FUNCTION update_modification_timestamp();
CREATE TRIGGER sync_integrations_time BEFORE UPDATE ON public.user_integrations FOR EACH ROW EXECUTE FUNCTION update_modification_timestamp();
CREATE TRIGGER sync_cards_time BEFORE UPDATE ON public.spaced_repetition_cards FOR EACH ROW EXECUTE FUNCTION update_modification_timestamp();

-- =====================================================================
-- 3.5. FINE-GRAINED DATA ACCESS ISOLATION (ROW LEVEL SECURITY POLICIES)
-- =====================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaced_repetition_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profile_isolation ON public.users FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY user_ledger_isolation ON public.usage_ledger FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_integrations_isolation ON public.user_integrations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_events_isolation ON public.learning_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_cards_isolation ON public.spaced_repetition_cards FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
