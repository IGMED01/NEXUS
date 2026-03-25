# Database Schema — PostgreSQL

## Tables

### users
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  role        VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);
```

### projects
```sql
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_status ON projects(status) WHERE status = 'active';
```

### documents
```sql
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  title       VARCHAR(500) NOT NULL,
  content     TEXT NOT NULL,
  mime_type   VARCHAR(100) DEFAULT 'text/plain',
  token_count INTEGER DEFAULT 0,
  embedding   VECTOR(1536),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_docs_project ON documents(project_id);
CREATE INDEX idx_docs_embedding ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### chunks
```sql
CREATE TABLE chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  position    INTEGER NOT NULL,
  token_count INTEGER DEFAULT 0,
  embedding   VECTOR(1536),
  tags        TEXT[] DEFAULT '{}',
  score       FLOAT DEFAULT 0.0
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);
CREATE INDEX idx_chunks_tags ON chunks USING gin(tags);
```

## Migrations Strategy
- Use numbered files: `001_initial.sql`, `002_add_embeddings.sql`
- Each migration is idempotent (uses `IF NOT EXISTS`)
- Rollback files: `001_initial.down.sql`
- Applied via `node scripts/migrate.js up`

## Queries — Common Patterns

### Semantic search (cosine similarity)
```sql
SELECT c.id, c.content, c.tags,
       1 - (c.embedding <=> $1::vector) AS similarity
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.project_id = $2
ORDER BY c.embedding <=> $1::vector
LIMIT 10;
```

### Full-text search fallback
```sql
SELECT id, content, ts_rank(to_tsvector('spanish', content), query) AS rank
FROM chunks, plainto_tsquery('spanish', $1) query
WHERE to_tsvector('spanish', content) @@ query
ORDER BY rank DESC LIMIT 10;
```

## Connection Pool
- Min connections: 2
- Max connections: 20
- Idle timeout: 30s
- Connection timeout: 5s
- SSL required in production
