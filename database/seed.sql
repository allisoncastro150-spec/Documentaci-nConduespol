INSERT INTO users (username, password_hash, role, department_id, must_change_password)
VALUES (
  'admin',
  crypt('admin2026', gen_salt('bf')),
  'admin',
  NULL,
  false
)
ON CONFLICT (username) DO NOTHING;
