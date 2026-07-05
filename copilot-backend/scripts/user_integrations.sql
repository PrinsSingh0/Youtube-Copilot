-- YOUTUBE COPILOT v4.0.0 — DATABASE MIGRATION SCRIPT (user_integrations.sql)
-- Run this script in your Supabase SQL Editor to configure the integrations schema.

CREATE TABLE IF NOT EXISTS public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    platform_name TEXT NOT NULL, -- 'github', 'notion', 'google_docs'
    encrypted_access_token TEXT NOT NULL,
    encryption_iv TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_user_platform UNIQUE (user_id, platform_name)
);

-- Optimize routing and lookup evaluations
CREATE INDEX IF NOT EXISTS idx_integrations_lookup ON public.user_integrations (user_id, platform_name);
