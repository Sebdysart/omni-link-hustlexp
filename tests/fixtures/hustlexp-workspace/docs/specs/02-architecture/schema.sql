CREATE TABLE users (
  id UUID PRIMARY KEY
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY
);

CREATE VIEW active_tasks AS
SELECT id FROM tasks;
