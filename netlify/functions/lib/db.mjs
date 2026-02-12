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
    // Check if ALL required tables exist (including new ones)
    const check = await sql`SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_name IN ('users', 'projects', 'tasks', 'content_items', 'milestones', 'working_groups', 'comments', 'tags')
        AND table_schema = 'public'`;
    
    const expectedTables = 8; // Number of key tables
    if (parseInt(check[0]?.count) >= expectedTables) {
      // Tables exist — check if projects are seeded
      const projectCheck = await sql`SELECT COUNT(*) as count FROM projects`;
      if (parseInt(projectCheck[0]?.count) === 0) {
        console.log('📦 Seeding project data...');
        await seedProjects();
      }
      migrationChecked = true;
      return;
    }
    
    // Run migrations - some tables missing
    console.log('🚀 Running database migration (some tables missing)...');
    await runMigrations();
    
    migrationChecked = true;
    console.log('✅ Database migration complete');
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
  
  // Seed projects
  await seedProjects();
}

async function seedProjects() {
  // Check if already seeded
  const existing = await sql`SELECT COUNT(*) as count FROM projects`;
  if (existing[0]?.count > 0) return;

  // Create a system user for seeded content
  const systemUserId = '00000000-0000-0000-0000-000000000001';
  await sql`INSERT INTO users (id, email, password_hash, display_name, role, bio)
    VALUES (${systemUserId}, 'system@postlaboreconomics.com', 'SYSTEM_NO_LOGIN', 'PLE Platform', 'admin',
      'System account for seeded content and platform operations.')
    ON CONFLICT (email) DO NOTHING`;

  // ── Project 1: GATO Framework Implementation ──
  const gatoId = '10000000-0000-0000-0000-000000000001';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${gatoId}, 'GATO Framework Implementation', 'gato-framework-implementation',
      'Build and deploy the Global Alignment Taxonomy Omnibus (GATO) framework as a living governance layer for AI agent alignment. Encompasses THE PRIME heuristic imperatives, the Pyramid of Power institutional reform model, and the Pyramid of Prosperity economic architecture. The goal is a production-ready alignment framework that AI developers can integrate into training pipelines and runtime decision systems.',
      'initiative', 'active', 'public', 'high', ${systemUserId}, '2025-06-01', '2026-06-30', 35)
    ON CONFLICT (slug) DO NOTHING`;

  const gatoM1 = '20000000-0000-0000-0000-000000000001';
  const gatoM2 = '20000000-0000-0000-0000-000000000002';
  const gatoM3 = '20000000-0000-0000-0000-000000000003';
  await sql`INSERT INTO milestones (id, project_id, title, description, target_date, status, order_index) VALUES
    (${gatoM1}, ${gatoId}, 'THE PRIME v1.0 Specification', 'Finalize the heuristic imperatives specification with formal proofs, thermodynamic analogies, and five-dimensional analysis. Publish as machine-readable schema.', '2025-09-30', 'completed', 1),
    (${gatoM2}, ${gatoId}, 'API & Integration Layer', 'Build the /api/gato endpoints for programmatic access. Create SDKs for Python and JavaScript. Document integration patterns for model training pipelines.', '2026-01-31', 'in_progress', 2),
    (${gatoM3}, ${gatoId}, 'Multi-Agent Coordination Protocol', 'Design and test the coordination layer that enables GATO-aligned agents to establish trust, share context, and resolve conflicts using THE PRIME as shared foundation.', '2026-06-30', 'upcoming', 3)
    ON CONFLICT DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, milestone_id, title, description, status, priority, order_index) VALUES
    (${gatoId}, ${gatoM1}, 'Draft formal specification for all three imperatives', 'Write the rigorous specification covering deontological, teleological, operational, alignment, and coordination dimensions.', 'done', 'high', 1),
    (${gatoId}, ${gatoM1}, 'Peer review with alignment researchers', 'Submit spec to external AI safety researchers for adversarial review and feedback.', 'done', 'high', 2),
    (${gatoId}, ${gatoM1}, 'Publish machine-readable PRIME schema (JSON-LD)', 'Create JSON-LD and OpenAPI schema so agents can programmatically parse and reference THE PRIME.', 'done', 'medium', 3),
    (${gatoId}, ${gatoM2}, 'Build /api/gato REST endpoints', 'Implement GET endpoints for prime, layers, and full framework content with versioning.', 'in_progress', 'high', 1),
    (${gatoId}, ${gatoM2}, 'Python SDK for GATO integration', 'Create pip-installable SDK: gato-align. Includes PRIME loader, value-check middleware, and agent scaffolding.', 'in_progress', 'high', 2),
    (${gatoId}, ${gatoM2}, 'JavaScript/TypeScript SDK', 'Create npm package @ple/gato for Node.js and browser environments.', 'todo', 'medium', 3),
    (${gatoId}, ${gatoM2}, 'Integration guide for model training pipelines', 'Document how to weight THE PRIME in RLHF, DPO, and constitutional AI training loops.', 'todo', 'medium', 4),
    (${gatoId}, ${gatoM3}, 'Design Byzantine-fault-tolerant trust protocol', 'Specify how agents verify each other''s PRIME alignment without central authority.', 'backlog', 'high', 1),
    (${gatoId}, ${gatoM3}, 'Prototype multi-agent negotiation sandbox', 'Build simulation environment where GATO-aligned agents negotiate resource allocation.', 'backlog', 'medium', 2),
    (${gatoId}, ${gatoM3}, 'Publish coordination protocol whitepaper', 'Write and publish the formal protocol specification for multi-agent coordination.', 'backlog', 'medium', 3)
    ON CONFLICT DO NOTHING`;

  // ── Project 2: Universal Basic Income Research Hub ──
  const ubiId = '10000000-0000-0000-0000-000000000002';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${ubiId}, 'UBI Research & Evidence Hub', 'ubi-research-evidence-hub',
      'Curate and synthesize the global body of evidence on Universal Basic Income—pilot programs, randomized controlled trials, economic modeling, and behavioral research. Produce accessible summaries and policy briefs that translate academic findings into actionable frameworks for advocates, policymakers, and journalists.',
      'research', 'active', 'public', 'high', ${systemUserId}, '2025-07-01', '2026-03-31', 22)
    ON CONFLICT (slug) DO NOTHING`;

  const ubiM1 = '20000000-0000-0000-0000-000000000004';
  const ubiM2 = '20000000-0000-0000-0000-000000000005';
  await sql`INSERT INTO milestones (id, project_id, title, description, target_date, status, order_index) VALUES
    (${ubiM1}, ${ubiId}, 'Global Pilot Database', 'Compile comprehensive database of every UBI and cash-transfer pilot worldwide with standardized outcomes, methodology ratings, and population data.', '2025-12-31', 'in_progress', 1),
    (${ubiM2}, ${ubiId}, 'Policy Brief Series', 'Publish 6 policy briefs: fiscal modeling, labor market effects, health outcomes, child development, entrepreneurship, and political feasibility.', '2026-03-31', 'upcoming', 2)
    ON CONFLICT DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, milestone_id, title, description, status, priority, order_index) VALUES
    (${ubiId}, ${ubiM1}, 'Catalog all completed UBI/cash-transfer pilots (2010–present)', 'Systematic review of GiveDirectly, Stockton SEED, Finland KELA, Kenya, India, and 40+ others.', 'in_progress', 'high', 1),
    (${ubiId}, ${ubiM1}, 'Standardize outcome metrics across pilots', 'Create unified schema: employment, health, education, well-being, entrepreneurship, spending.', 'in_progress', 'medium', 2),
    (${ubiId}, ${ubiM1}, 'Build searchable database interface', 'Web UI with filters by country, duration, sample size, payment amount, and outcome category.', 'todo', 'medium', 3),
    (${ubiId}, ${ubiM2}, 'Draft fiscal modeling brief', 'Model UBI costs and funding mechanisms (automation tax, data dividends, sovereign wealth) for the US.', 'backlog', 'high', 1),
    (${ubiId}, ${ubiM2}, 'Draft labor market effects brief', 'Synthesize evidence on labor supply, job transitions, and entrepreneurship rates.', 'backlog', 'high', 2),
    (${ubiId}, ${ubiM2}, 'Commission peer review for all briefs', 'Engage 3 economists per brief for independent review before publication.', 'backlog', 'medium', 3)
    ON CONFLICT DO NOTHING`;

  // ── Project 3: Automation Tax Framework ──
  const autoTaxId = '10000000-0000-0000-0000-000000000003';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${autoTaxId}, 'Automation Tax Policy Framework', 'automation-tax-framework',
      'Develop a rigorous, implementable policy framework for taxing automated labor. Addresses the core challenge: as AI and robotics replace human workers, tax revenue (which depends on payroll) erodes while corporate profits concentrate. This project designs mechanisms—robot taxes, compute levies, AI licensing fees—that fund universal programs without stifling innovation.',
      'policy', 'active', 'public', 'urgent', ${systemUserId}, '2025-08-01', '2026-04-30', 15)
    ON CONFLICT (slug) DO NOTHING`;

  const atM1 = '20000000-0000-0000-0000-000000000006';
  const atM2 = '20000000-0000-0000-0000-000000000007';
  await sql`INSERT INTO milestones (id, project_id, title, description, target_date, status, order_index) VALUES
    (${atM1}, ${autoTaxId}, 'Comparative Analysis', 'Analyze existing automation tax proposals (Gates robot tax, EU proposals, South Korea deductions) and model their projected revenue and innovation impact.', '2025-12-31', 'in_progress', 1),
    (${atM2}, ${autoTaxId}, 'Draft Model Legislation', 'Write model legislation adaptable to US federal, state, and EU contexts. Include compliance mechanisms and revenue allocation formulas.', '2026-04-30', 'upcoming', 2)
    ON CONFLICT DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, milestone_id, title, description, status, priority, order_index) VALUES
    (${autoTaxId}, ${atM1}, 'Map global automation tax proposals', 'Comprehensive inventory of every proposed or enacted automation/robot tax worldwide.', 'in_progress', 'high', 1),
    (${autoTaxId}, ${atM1}, 'Economic impact modeling', 'Build models projecting revenue, employment effects, and innovation metrics for 3 tax designs.', 'todo', 'high', 2),
    (${autoTaxId}, ${atM1}, 'Industry impact assessment', 'Analyze sector-by-sector effects on manufacturing, logistics, service, and knowledge work.', 'todo', 'medium', 3),
    (${autoTaxId}, ${atM2}, 'Draft federal model bill', 'Write a US federal bill template with compute-based levy, compliance mechanisms, and UBI fund allocation.', 'backlog', 'high', 1),
    (${autoTaxId}, ${atM2}, 'Draft EU-compatible framework', 'Adapt the model to EU regulatory context including GDPR, AI Act, and existing social frameworks.', 'backlog', 'medium', 2)
    ON CONFLICT DO NOTHING`;

  // ── Project 4: Data Dividends Pilot Design ──
  const dataId = '10000000-0000-0000-0000-000000000004';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${dataId}, 'Data Dividends Pilot Design', 'data-dividends-pilot',
      'Design a pilot program for data dividends—direct payments to individuals from the value generated by their personal data. Inspired by the Alaska Permanent Fund model but applied to the data economy. The pilot will test payment mechanisms, valuation models, and user experience in a controlled setting before scaling.',
      'pilot', 'planning', 'public', 'medium', ${systemUserId}, '2025-10-01', '2026-09-30', 8)
    ON CONFLICT (slug) DO NOTHING`;

  const ddM1 = '20000000-0000-0000-0000-000000000008';
  await sql`INSERT INTO milestones (id, project_id, title, description, target_date, status, order_index) VALUES
    (${ddM1}, ${dataId}, 'Pilot Design Document', 'Complete pilot design specifying: participant selection, data valuation methodology, payment frequency, measurement framework, and IRB approval pathway.', '2026-03-31', 'upcoming', 1)
    ON CONFLICT DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, milestone_id, title, description, status, priority, order_index) VALUES
    (${dataId}, ${ddM1}, 'Literature review on data valuation methodologies', 'Survey academic work on individual data valuation: Posner/Weyl radical markets, Lanier dignity models, EU data portability.', 'in_progress', 'high', 1),
    (${dataId}, ${ddM1}, 'Design payment mechanism', 'Evaluate direct deposit, crypto/stablecoin, and prepaid card options for distributing data dividends.', 'todo', 'medium', 2),
    (${dataId}, ${ddM1}, 'Define pilot population criteria', 'Determine sample size, demographics, geographic scope, and recruitment strategy.', 'todo', 'medium', 3),
    (${dataId}, ${ddM1}, 'Draft IRB application', 'Prepare institutional review board application for human subjects research.', 'backlog', 'high', 4)
    ON CONFLICT DO NOTHING`;

  // ── Project 5: Post-Labor Economics Platform ──
  const platId = '10000000-0000-0000-0000-000000000005';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${platId}, 'PLE Platform Development', 'ple-platform-development',
      'Build and iterate on this platform—the community''s digital home for governance, research, content, and coordination. Features include enterprise architecture management, proposal/voting system, project management with Kanban boards, content publishing pipeline, and community discussion forums. Dogfooding the tools we build for the movement.',
      'technical', 'active', 'public', 'high', ${systemUserId}, '2025-05-01', '2026-12-31', 42)
    ON CONFLICT (slug) DO NOTHING`;

  const plM1 = '20000000-0000-0000-0000-000000000009';
  const plM2 = '20000000-0000-0000-0000-000000000010';
  const plM3 = '20000000-0000-0000-0000-000000000011';
  await sql`INSERT INTO milestones (id, project_id, title, description, target_date, status, order_index) VALUES
    (${plM1}, ${platId}, 'Core Platform v1.0', 'Auth, architecture explorer, proposals, discussions, and basic dashboard. Deployed on Netlify with auto-provisioned Postgres.', '2025-10-31', 'completed', 1),
    (${plM2}, ${platId}, 'Projects & Content v2.0', 'Full project management (Kanban, milestones, working groups), content CMS with publishing workflow, and GATO integration.', '2026-03-31', 'in_progress', 2),
    (${plM3}, ${platId}, 'Community & Analytics v3.0', 'Member profiles, reputation system, activity feeds, analytics dashboard, and notification system.', '2026-09-30', 'upcoming', 3)
    ON CONFLICT DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, milestone_id, title, description, status, priority, order_index) VALUES
    (${platId}, ${plM1}, 'Authentication system (register, login, sessions)', NULL, 'done', 'high', 1),
    (${platId}, ${plM1}, 'Architecture explorer with element relationships', NULL, 'done', 'high', 2),
    (${platId}, ${plM1}, 'Proposal system with voting', NULL, 'done', 'high', 3),
    (${platId}, ${plM1}, 'Discussion forums', NULL, 'done', 'medium', 4),
    (${platId}, ${plM2}, 'Project management with Kanban boards', NULL, 'done', 'high', 1),
    (${platId}, ${plM2}, 'Milestones and task dependencies', NULL, 'in_progress', 'high', 2),
    (${platId}, ${plM2}, 'Content CMS with version history', NULL, 'in_progress', 'high', 3),
    (${platId}, ${plM2}, 'GATO Framework interactive pages', NULL, 'done', 'medium', 4),
    (${platId}, ${plM2}, 'Brand system (Structured Optimism) integration', NULL, 'done', 'medium', 5),
    (${platId}, ${plM3}, 'Member profiles and reputation scoring', NULL, 'backlog', 'high', 1),
    (${platId}, ${plM3}, 'Activity feed and notifications', NULL, 'backlog', 'medium', 2),
    (${platId}, ${plM3}, 'Analytics dashboard for project health', NULL, 'backlog', 'medium', 3)
    ON CONFLICT DO NOTHING`;

  // ── Project 6: Stakeholder Coalition ──
  const coalId = '10000000-0000-0000-0000-000000000006';
  await sql`INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority, owner_id, start_date, target_end_date, progress)
    VALUES (${coalId}, 'Post-Labor Stakeholder Coalition', 'stakeholder-coalition',
      'Build a broad coalition of organizations, researchers, policymakers, and community leaders aligned around post-labor economics principles. Coordinate across labor unions, tech ethics orgs, UBI advocacy groups, think tanks, and academic institutions to create a unified voice for structural economic reform.',
      'initiative', 'planning', 'public', 'medium', ${systemUserId}, '2025-11-01', '2026-08-31', 5)
    ON CONFLICT (slug) DO NOTHING`;

  await sql`INSERT INTO tasks (project_id, title, description, status, priority, order_index) VALUES
    (${coalId}, 'Map potential coalition partners', 'Identify and categorize 50+ organizations by sector, alignment, and engagement readiness.', 'in_progress', 'high', 1),
    (${coalId}, 'Draft coalition charter', 'Write shared principles document that potential partners can endorse without compromising their own missions.', 'todo', 'high', 2),
    (${coalId}, 'Design outreach strategy', 'Create tiered engagement plan: awareness → endorsement → active participation → leadership.', 'todo', 'medium', 3),
    (${coalId}, 'Plan inaugural coalition summit', 'Design a virtual summit bringing together founding coalition members for alignment and planning.', 'backlog', 'medium', 4)
    ON CONFLICT DO NOTHING`;

  // ── Working Groups ──
  await sql`INSERT INTO working_groups (name, slug, description, project_id, lead_id, status) VALUES
    ('AI Alignment Research', 'ai-alignment-research', 'Researchers and engineers working on GATO framework specification and agent integration.', ${gatoId}, ${systemUserId}, 'active'),
    ('Policy Analysis Team', 'policy-analysis', 'Economists and policy analysts developing automation tax and UBI frameworks.', ${autoTaxId}, ${systemUserId}, 'active'),
    ('Platform Engineering', 'platform-engineering', 'Developers building and maintaining the PLE platform.', ${platId}, ${systemUserId}, 'active'),
    ('Content & Communications', 'content-comms', 'Writers, editors, and media producers creating public-facing content.', ${ubiId}, ${systemUserId}, 'forming'),
    ('Community Organizing', 'community-organizing', 'Coordinators building the stakeholder coalition and community engagement.', ${coalId}, ${systemUserId}, 'forming')
    ON CONFLICT (slug) DO NOTHING`;

  console.log('✅ Seeded 6 projects with milestones, tasks, and working groups');
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
