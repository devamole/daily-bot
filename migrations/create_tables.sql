-- Tabla de usuarios registrados
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL
);

-- Mensajes recibidos / enviados
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  text TEXT,
  timestamp INTEGER,
  type TEXT
);

-- Estado diario por usuario y fecha
CREATE TABLE IF NOT EXISTS daily_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  state TEXT,      -- "pending_morning","pending_update","done","needs_followup"
  score INTEGER
);

-- Preguntas de follow-up pendientes
CREATE TABLE IF NOT EXISTS pending_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  daily_id INTEGER NOT NULL,
  type TEXT,       -- "followup_question"
  sent BOOLEAN DEFAULT FALSE
);

-- Respuestas de follow-up
CREATE TABLE IF NOT EXISTS follow_up_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pending_id INTEGER NOT NULL,
  text TEXT,
  timestamp INTEGER
);
