-- Add indexes for reflections table
-- These indexes improve query performance for common lookups

CREATE INDEX IF NOT EXISTS idx_reflections_thread_id ON reflections(thread_id);
CREATE INDEX IF NOT EXISTS idx_reflections_resource_id ON reflections(resource_id);
CREATE INDEX IF NOT EXISTS idx_reflections_generation ON reflections(generation_count);
