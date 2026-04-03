-- Migration 002: Add staff accounts for role-based access
-- Run: psql $DATABASE_URL -f migrations/002_add_staff.sql

CREATE TABLE IF NOT EXISTS cafe_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (cafe_id, email)
);

CREATE INDEX IF NOT EXISTS idx_cafe_staff_cafe_id ON cafe_staff(cafe_id);
CREATE INDEX IF NOT EXISTS idx_cafe_staff_email ON cafe_staff(email);

CREATE TRIGGER update_cafe_staff_updated_at
    BEFORE UPDATE ON cafe_staff
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
