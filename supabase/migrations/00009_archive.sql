-- Asia Petrol CRM: Year Archive

CREATE TABLE archive_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL UNIQUE,
  archived_at TIMESTAMPTZ DEFAULT now(),
  archived_by UUID REFERENCES profiles(id),
  is_locked BOOLEAN DEFAULT true
);
