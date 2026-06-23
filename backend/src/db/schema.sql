-- ============================================================
-- Schema PostgreSQL - Sistema de Entrevistas v2.0
-- leIA + Recall.ai + ElevenLabs
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- Jobs (puestos generados a partir de un link)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_link   TEXT NOT NULL,
    title         TEXT NOT NULL,
    company       TEXT NOT NULL,
    description   TEXT NOT NULL,
    requirements  JSONB NOT NULL,
    preferences   JSONB NOT NULL,
    raw_text      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs (title);

-- ----------------------------------------------------------------
-- Candidates
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email        TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    phone        TEXT,
    cv_url       TEXT,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates (email);

-- ----------------------------------------------------------------
-- Interviews
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    candidate_id          UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    status                TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (status IN ('pendiente','agendada','en_curso','completada','cancelada','error')),
    meet_url              TEXT NOT NULL,
    tts_driver            TEXT NOT NULL DEFAULT 'gemini'
                          CHECK (tts_driver IN ('gemini','edge')),
    recall_bot_id         TEXT,
    scheduled_at          TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    duration_sec          INTEGER,
    behavioral_analysis   JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_job ON interviews (job_id);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews (candidate_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews (status);

ALTER TABLE interviews
    ADD COLUMN IF NOT EXISTS tts_driver TEXT NOT NULL DEFAULT 'gemini';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_interviews_tts_driver'
    ) THEN
        ALTER TABLE interviews
            ADD CONSTRAINT chk_interviews_tts_driver
            CHECK (tts_driver IN ('gemini','edge'));
    END IF;
END $$;

-- ----------------------------------------------------------------
-- Interview turns (par pregunta/respuesta)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interview_turns (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interview_id       UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    "index"            INTEGER NOT NULL,
    question           TEXT NOT NULL,
    question_at        TIMESTAMPTZ NOT NULL,
    answer_transcript  TEXT NOT NULL DEFAULT '',
    answer_at          TIMESTAMPTZ,
    duration_sec       INTEGER NOT NULL DEFAULT 0,
    evaluation_id      UUID
);

CREATE INDEX IF NOT EXISTS idx_turns_interview ON interview_turns (interview_id, "index");

-- ----------------------------------------------------------------
-- Transcripts (fragmentos de captions de Meet)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcripts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interview_id  UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    speaker       TEXT NOT NULL CHECK (speaker IN ('bot','candidate','other')),
    text          TEXT NOT NULL,
    start_ms      INTEGER NOT NULL,
    end_ms        INTEGER NOT NULL,
    is_final      BOOLEAN NOT NULL DEFAULT TRUE,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_interview ON transcripts (interview_id, start_ms);

-- ----------------------------------------------------------------
-- Evaluations
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interview_id  UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    turn_id       UUID NOT NULL REFERENCES interview_turns(id) ON DELETE CASCADE,
    score         NUMERIC(4,2) NOT NULL,
    dimensions    JSONB NOT NULL,
    flags         JSONB NOT NULL DEFAULT '[]'::jsonb,
    rationale     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_interview ON evaluations (interview_id);

-- ----------------------------------------------------------------
-- Reports (Informe 1 y 2 por entrevista)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interview_id  UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind          SMALLINT NOT NULL CHECK (kind IN (1,2)),
    payload       JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (interview_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_reports_candidate ON reports (candidate_id);
CREATE INDEX IF NOT EXISTS idx_reports_job ON reports (job_id);

-- ----------------------------------------------------------------
-- Audit
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity     TEXT NOT NULL,
    entity_id  UUID NOT NULL,
    action     TEXT NOT NULL,
    actor      TEXT NOT NULL,
    metadata   JSONB,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity, entity_id);
