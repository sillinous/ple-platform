/**
 * PLE Platform - Database Module
 * Handles connection and auto-migration on first use
 */

import { neon } from '@netlify/neon';

const sql = neon();

// Migration status tracking (per-instance, runs once per cold start)
let migrationChecked = false;

/**
 * Ensure database is initialized before any query
 * Runs idempotent migrations on cold start
 */
export async function ensureDatabase() {
  if (migrationChecked) return;
  
  try {
    // Quick check - if users table exists, we're good
    const check = await sql`SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'users'
    )`;
    
    if (check[0]?.exists) {
      migrationChecked = true;
      return;
    }
    
    // Run migrations
    console.log('🚀 Running database initialization...');
    await runMigrations();
    
    migrationChecked = true;
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    migrationChecked = true;
    throw error;
  }
}

async function runMigrations() {
  // Users table
  await sql`CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'member',
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
  )`;

  // Architecture Elements
  await sql`CREATE TABLE IF NOT EXISTS architecture_elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    element_type VARCHAR(50) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft',
    parent_id UUID REFERENCES architecture_elements(id),
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // Element relationships
  await sql`CREATE TABLE IF NOT EXISTS element_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID,
    target_id UUID,
    relationship_type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Proposals
  await sql`CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    proposal_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    author_id UUID,
    element_id UUID,
    voting_starts TIMESTAMP,
    voting_ends TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // Votes
  await sql`CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID,
    user_id UUID,
    vote_type VARCHAR(20) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proposal_id, user_id)
  )`;

  // Discussions
  await sql`CREATE TABLE IF NOT EXISTS discussions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200),
    content TEXT NOT NULL,
    author_id UUID,
    parent_id UUID,
    proposal_id UUID,
    element_id UUID,
    discussion_type VARCHAR(50) DEFAULT 'general',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Activity log
  await sql`CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Sessions
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT
  )`;

  // ==========================================
  // PROJECTS & WORK MANAGEMENT
  // ==========================================

  // Projects
  await sql`CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(200) UNIQUE NOT NULL,
    description TEXT,
    project_type VARCHAR(50) DEFAULT 'initiative',
    status VARCHAR(50) DEFAULT 'draft',
    visibility VARCHAR(50) DEFAULT 'members',
    priority VARCHAR(20) DEFAULT 'medium',
    owner_id UUID REFERENCES users(id),
    linked_proposal_id UUID REFERENCES proposals(id),
    linked_elements JSONB DEFAULT '[]',
    start_date DATE,
    target_end_date DATE,
    actual_end_date DATE,
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // Working Groups (Teams)
  await sql`CREATE TABLE IF NOT EXISTS working_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    project_id UUID REFERENCES projects(id),
    lead_id UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'forming',
    visibility VARCHAR(50) DEFAULT 'members',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // Working Group Members
  await sql`CREATE TABLE IF NOT EXISTS working_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES working_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    UNIQUE(group_id, user_id)
  )`;

  // Milestones
  await sql`CREATE TABLE IF NOT EXISTS milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    target_date DATE,
    completed_date DATE,
    status VARCHAR(50) DEFAULT 'upcoming',
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Tasks
  await sql`CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'backlog',
    priority VARCHAR(20) DEFAULT 'medium',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    due_date DATE,
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    order_index INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // ==========================================
  // CONTENT MANAGEMENT SYSTEM
  // ==========================================

  // Content Items
  await sql`CREATE TABLE IF NOT EXISTS content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(300) NOT NULL,
    slug VARCHAR(300) UNIQUE NOT NULL,
    content_type VARCHAR(50) DEFAULT 'article',
    body TEXT,
    excerpt TEXT,
    status VARCHAR(50) DEFAULT 'draft',
    visibility VARCHAR(50) DEFAULT 'internal',
    author_id UUID REFERENCES users(id),
    reviewer_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    version INTEGER DEFAULT 1,
    featured_image TEXT,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`;

  // Content Versions (for version history)
  await sql`CREATE TABLE IF NOT EXISTS content_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    changed_by UUID REFERENCES users(id),
    change_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Generic Comments (attach to any entity)
  await sql`CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    author_id UUID REFERENCES users(id),
    body TEXT NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Attachments (files for any entity)
  await sql`CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INTEGER,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;

  // Tags (for content organization)
  await sql`CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#6B7280'
  )`;

  // Content Tags (many-to-many)
  await sql`CREATE TABLE IF NOT EXISTS content_tags (
    content_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
  )`;

  // Create indexes for performance
  await sql`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_status ON content_items(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(content_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id)`;

  // Seed architecture data
  await seedArchitecture();
}

async function seedArchitecture() {
  // Check if already seeded
  const existing = await sql`SELECT COUNT(*) as count FROM architecture_elements`;
  if (existing[0]?.count > 0) return;

  // Seed goals
  const goals = [
    ['goal', 'GOAL-001', 'Universal Basic Income', 'Establish economic security through unconditional basic income for all citizens', 'active'],
    ['goal', 'GOAL-002', 'Data Ownership Rights', 'Ensure individuals own and control their personal data with fair compensation', 'active'],
    ['goal', 'GOAL-003', 'Automation Taxation', 'Implement fair taxation on automated labor to fund social programs', 'active'],
    ['goal', 'GOAL-004', 'Worker Transition Support', 'Provide comprehensive support for workers displaced by automation', 'active'],
    ['goal', 'GOAL-005', 'Democratic Economic Governance', 'Enable democratic participation in economic policy decisions', 'active'],
    ['goal', 'GOAL-006', 'Evidence-Based Policy', 'Ground all proposals in rigorous research and empirical evidence', 'active'],
    ['goal', 'GOAL-007', 'Public Awareness', 'Build broad public understanding of post-labor economics concepts', 'active'],
    ['goal', 'GOAL-008', 'Coalition Building', 'Unite diverse stakeholders around shared prosperity goals', 'active'],
    ['goal', 'GOAL-009', 'Institutional Reform', 'Transform institutions to support post-labor economic models', 'active']
  ];

  for (const [type, code, title, desc, status] of goals) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}) ON CONFLICT (code) DO NOTHING`;
  }

  // Seed strategies
  const strategies = [
    ['strategy', 'STRAT-001', 'Research & Analysis', 'Conduct and synthesize research on post-labor economics', 'active'],
    ['strategy', 'STRAT-002', 'Public Education', 'Educate the public through content, events, and media', 'active'],
    ['strategy', 'STRAT-003', 'Policy Development', 'Develop concrete policy proposals and frameworks', 'active'],
    ['strategy', 'STRAT-004', 'Community Building', 'Build engaged communities of practitioners and advocates', 'active'],
    ['strategy', 'STRAT-005', 'Pilot Programs', 'Design and support pilot implementations', 'active'],
    ['strategy', 'STRAT-006', 'Stakeholder Engagement', 'Engage policymakers, businesses, and civil society', 'active']
  ];

  for (const [type, code, title, desc, status] of strategies) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}) ON CONFLICT (code) DO NOTHING`;
  }

  // Seed capabilities
  const capabilities = [
    ['capability', 'CAP-001', 'Policy Analysis', 'Analyze existing and proposed economic policies', 'active'],
    ['capability', 'CAP-002', 'Research Synthesis', 'Synthesize academic research into actionable insights', 'active'],
    ['capability', 'CAP-003', 'Advocacy & Outreach', 'Advocate for post-labor policies to decision makers', 'active'],
    ['capability', 'CAP-004', 'Content Production', 'Create articles, videos, podcasts, and educational materials', 'active'],
    ['capability', 'CAP-005', 'Community Facilitation', 'Facilitate discussions and working groups', 'active'],
    ['capability', 'CAP-006', 'Event Management', 'Organize webinars, conferences, and community events', 'active'],
    ['capability', 'CAP-007', 'Data Analysis', 'Analyze economic data and model scenarios', 'active'],
    ['capability', 'CAP-008', 'Partnership Development', 'Build partnerships with aligned organizations', 'active']
  ];

  for (const [type, code, title, desc, status] of capabilities) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}) ON CONFLICT (code) DO NOTHING`;
  }

  // Seed principles
  const principles = [
    ['principle', 'PRIN-001', 'Human Dignity First', 'All policies must prioritize human dignity and wellbeing', 'active'],
    ['principle', 'PRIN-002', 'Evidence-Based Approach', 'Decisions grounded in research and empirical evidence', 'active'],
    ['principle', 'PRIN-003', 'Inclusive Participation', 'Ensure diverse voices in all decision-making processes', 'active'],
    ['principle', 'PRIN-004', 'Transparency', 'Operate with full transparency in governance and finances', 'active'],
    ['principle', 'PRIN-005', 'Open Source First', 'Prefer open source tools and open knowledge sharing', 'active'],
    ['principle', 'PRIN-006', 'Pragmatic Idealism', 'Balance ambitious vision with practical implementation', 'active'],
    ['principle', 'PRIN-007', 'Federated Governance', 'Distribute power across community working groups', 'active'],
    ['principle', 'PRIN-008', 'Continuous Learning', 'Embrace iteration and learning from failures', 'active'],
    ['principle', 'PRIN-009', 'Solidarity Economy', 'Model the economic principles we advocate', 'active'],
    ['principle', 'PRIN-010', 'Long-term Thinking', 'Plan for generational impact, not quick wins', 'active']
  ];

  for (const [type, code, title, desc, status] of principles) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}) ON CONFLICT (code) DO NOTHING`;
  }
}

/**
 * Get database query function (with auto-init)
 */
export async function getDb() {
  await ensureDatabase();
  return sql;
}

/**
 * Helper to hash tokens
 */
export async function hashToken(token) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get current user from request
 */
export async function getCurrentUser(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const token = authHeader.slice(7);
  const tokenHash = await hashToken(token);
  const db = await getDb();
  
  const sessions = await db`
    SELECT u.id, u.email, u.display_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = true
  `;
  
  return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Log activity
 */
export async function logActivity(userId, action, entityType, entityId, details = {}) {
  try {
    const db = await getDb();
    const detailsJson = JSON.stringify(details);
    await db`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) 
             VALUES (${userId}, ${action}, ${entityType}, ${entityId}, ${detailsJson})`;
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

/**
 * JSON response helper
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export { sql };
