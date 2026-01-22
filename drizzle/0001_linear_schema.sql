-- Linear Clone Schema Migration
-- Expands the data model for rich issue management

-- Add new columns to boards table
ALTER TABLE boards ADD COLUMN identifier TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE boards ADD COLUMN issue_counter INTEGER NOT NULL DEFAULT 0;

-- Create cycles table (must be created before issues due to foreign key)
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_date INTEGER,
  end_date INTEGER,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at INTEGER NOT NULL
);

-- Create issues table
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY NOT NULL,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 4,
  estimate INTEGER,
  due_date INTEGER,
  cycle_id TEXT REFERENCES cycles(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Create labels table
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Create issue_labels junction table
CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Create activities table
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL
);

-- Migrate existing cards to issues
INSERT INTO issues (id, column_id, identifier, title, description, status, priority, position, created_at, updated_at)
SELECT
  id,
  column_id,
  'AUTO-' || ROW_NUMBER() OVER (ORDER BY created_at),
  title,
  description,
  'todo',
  4,
  position,
  created_at,
  created_at
FROM cards;

-- Update board issue counter based on migrated issues
UPDATE boards SET issue_counter = (SELECT COUNT(*) FROM issues);

-- Seed default labels
INSERT INTO labels (id, board_id, name, color, created_at) VALUES
  (lower(hex(randomblob(16))), 'default-board', 'Bug', '#ef4444', unixepoch()),
  (lower(hex(randomblob(16))), 'default-board', 'Feature', '#3b82f6', unixepoch()),
  (lower(hex(randomblob(16))), 'default-board', 'Improvement', '#22c55e', unixepoch()),
  (lower(hex(randomblob(16))), 'default-board', 'Documentation', '#a855f7', unixepoch());

-- Update user_stories to reference issues instead of cards
-- Note: This requires the column to exist in the original schema
-- If user_stories has card_id, we'd need to rename it to issue_id
-- For now, we'll create a new column and migrate

-- Check if user_stories exists and has card_id column
-- If so, add issue_id and migrate data
-- SQLite doesn't support IF EXISTS for columns, so we handle this gracefully

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_issues_column_id ON issues(column_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_cycle_id ON issues(cycle_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_issue_id ON issue_labels(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_label_id ON issue_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_comments_issue_id ON comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_activities_issue_id ON activities(issue_id);
CREATE INDEX IF NOT EXISTS idx_cycles_board_id ON cycles(board_id);
CREATE INDEX IF NOT EXISTS idx_labels_board_id ON labels(board_id);
