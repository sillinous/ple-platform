/**
 * PLE Platform Database Migration
 * Run with: npm run db:migrate
 * 
 * This creates all tables needed for the platform.
 * Requires NETLIFY_DATABASE_URL environment variable.
 */

import { neon } from '@netlify/neon';

const sql = neon();

const migrations = [
  // Users table
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,

  // Architecture Elements (TOGAF/BMM)
  `CREATE TABLE IF NOT EXISTS architecture_elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    element_type VARCHAR(50) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft',
    parent_id UUID REFERENCES architecture_elements(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`,

  // Index for element lookups
  `CREATE INDEX IF NOT EXISTS idx_arch_elements_type ON architecture_elements(element_type)`,
  `CREATE INDEX IF NOT EXISTS idx_arch_elements_code ON architecture_elements(code)`,
  `CREATE INDEX IF NOT EXISTS idx_arch_elements_status ON architecture_elements(status)`,

  // Element relationships (many-to-many)
  `CREATE TABLE IF NOT EXISTS element_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES architecture_elements(id) ON DELETE CASCADE,
    target_id UUID REFERENCES architecture_elements(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, target_id, relationship_type)
  )`,

  // Proposals for governance
  `CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    proposal_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    author_id UUID REFERENCES users(id),
    element_id UUID REFERENCES architecture_elements(id),
    voting_starts TIMESTAMP,
    voting_ends TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`,
  `CREATE INDEX IF NOT EXISTS idx_proposals_type ON proposals(proposal_type)`,

  // Votes on proposals
  `CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES proposals(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    vote_type VARCHAR(20) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proposal_id, user_id)
  )`,

  // Discussions/Comments
  `CREATE TABLE IF NOT EXISTS discussions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200),
    content TEXT NOT NULL,
    author_id UUID REFERENCES users(id),
    parent_id UUID REFERENCES discussions(id),
    proposal_id UUID REFERENCES proposals(id),
    element_id UUID REFERENCES architecture_elements(id),
    discussion_type VARCHAR(50) DEFAULT 'general',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_discussions_proposal ON discussions(proposal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_discussions_element ON discussions(element_id)`,
  `CREATE INDEX IF NOT EXISTS idx_discussions_parent ON discussions(parent_id)`,

  // Content (articles, research, media)
  `CREATE TABLE IF NOT EXISTS content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(200) UNIQUE NOT NULL,
    body TEXT,
    excerpt TEXT,
    content_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    author_id UUID REFERENCES users(id),
    featured_image TEXT,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type)`,
  `CREATE INDEX IF NOT EXISTS idx_content_status ON content(status)`,
  `CREATE INDEX IF NOT EXISTS idx_content_slug ON content(slug)`,

  // Content to architecture element mapping
  `CREATE TABLE IF NOT EXISTS content_elements (
    content_id UUID REFERENCES content(id) ON DELETE CASCADE,
    element_id UUID REFERENCES architecture_elements(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, element_id)
  )`,

  // Activity log
  `CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC)`,

  // Sessions for auth
  `CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`,

  // Seed initial architecture elements (Goals)
  `INSERT INTO architecture_elements (element_type, code, title, description, status) VALUES
    ('goal', 'GOAL-001', 'Universal Basic Income', 'Establish economic security through unconditional basic income for all citizens', 'active'),
    ('goal', 'GOAL-002', 'Data Ownership Rights', 'Ensure individuals own and control their personal data with fair compensation', 'active'),
    ('goal', 'GOAL-003', 'Automation Taxation', 'Implement fair taxation on automated labor to fund social programs', 'active'),
    ('goal', 'GOAL-004', 'Worker Transition Support', 'Provide comprehensive support for workers displaced by automation', 'active'),
    ('goal', 'GOAL-005', 'Democratic Economic Governance', 'Enable democratic participation in economic policy decisions', 'active'),
    ('goal', 'GOAL-006', 'Evidence-Based Policy', 'Ground all proposals in rigorous research and empirical evidence', 'active'),
    ('goal', 'GOAL-007', 'Public Awareness', 'Build broad public understanding of post-labor economics concepts', 'active'),
    ('goal', 'GOAL-008', 'Coalition Building', 'Unite diverse stakeholders around shared prosperity goals', 'active'),
    ('goal', 'GOAL-009', 'Institutional Reform', 'Transform institutions to support post-labor economic models', 'active')
  ON CONFLICT (code) DO NOTHING`,

  // Seed strategies
  `INSERT INTO architecture_elements (element_type, code, title, description, status) VALUES
    ('strategy', 'STRAT-001', 'Research & Analysis', 'Conduct and synthesize research on post-labor economics', 'active'),
    ('strategy', 'STRAT-002', 'Public Education', 'Educate the public through content, events, and media', 'active'),
    ('strategy', 'STRAT-003', 'Policy Development', 'Develop concrete policy proposals and frameworks', 'active'),
    ('strategy', 'STRAT-004', 'Community Building', 'Build engaged communities of practitioners and advocates', 'active'),
    ('strategy', 'STRAT-005', 'Pilot Programs', 'Design and support pilot implementations', 'active'),
    ('strategy', 'STRAT-006', 'Stakeholder Engagement', 'Engage policymakers, businesses, and civil society', 'active')
  ON CONFLICT (code) DO NOTHING`,

  // Seed capabilities
  `INSERT INTO architecture_elements (element_type, code, title, description, status) VALUES
    ('capability', 'CAP-001', 'Policy Analysis', 'Analyze existing and proposed economic policies', 'active'),
    ('capability', 'CAP-002', 'Research Synthesis', 'Synthesize academic research into actionable insights', 'active'),
    ('capability', 'CAP-003', 'Advocacy & Outreach', 'Advocate for post-labor policies to decision makers', 'active'),
    ('capability', 'CAP-004', 'Content Production', 'Create articles, videos, podcasts, and educational materials', 'active'),
    ('capability', 'CAP-005', 'Community Facilitation', 'Facilitate discussions and working groups', 'active'),
    ('capability', 'CAP-006', 'Event Management', 'Organize webinars, conferences, and community events', 'active'),
    ('capability', 'CAP-007', 'Data Analysis', 'Analyze economic data and model scenarios', 'active'),
    ('capability', 'CAP-008', 'Partnership Development', 'Build partnerships with aligned organizations', 'active')
  ON CONFLICT (code) DO NOTHING`,

  // Seed principles
  `INSERT INTO architecture_elements (element_type, code, title, description, status) VALUES
    ('principle', 'PRIN-001', 'Human Dignity First', 'All policies must prioritize human dignity and wellbeing', 'active'),
    ('principle', 'PRIN-002', 'Evidence-Based Approach', 'Decisions grounded in research and empirical evidence', 'active'),
    ('principle', 'PRIN-003', 'Inclusive Participation', 'Ensure diverse voices in all decision-making processes', 'active'),
    ('principle', 'PRIN-004', 'Transparency', 'Operate with full transparency in governance and finances', 'active'),
    ('principle', 'PRIN-005', 'Open Source First', 'Prefer open source tools and open knowledge sharing', 'active'),
    ('principle', 'PRIN-006', 'Pragmatic Idealism', 'Balance ambitious vision with practical implementation', 'active'),
    ('principle', 'PRIN-007', 'Federated Governance', 'Distribute power across community working groups', 'active'),
    ('principle', 'PRIN-008', 'Continuous Learning', 'Embrace iteration and learning from failures', 'active'),
    ('principle', 'PRIN-009', 'Solidarity Economy', 'Model the economic principles we advocate', 'active'),
    ('principle', 'PRIN-010', 'Long-term Thinking', 'Plan for generational impact, not quick wins', 'active')
  ON CONFLICT (code) DO NOTHING`
];

async function migrate() {
  console.log('🚀 Starting PLE Platform database migration...\n');
  
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i];
    const preview = migration.substring(0, 60).replace(/\n/g, ' ');
    
    try {
      await sql(migration);
      console.log(`✅ [${i + 1}/${migrations.length}] ${preview}...`);
    } catch (error) {
      // Skip "already exists" errors for idempotency
      if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
        console.log(`⏭️  [${i + 1}/${migrations.length}] Already exists, skipping...`);
      } else {
        console.error(`❌ [${i + 1}/${migrations.length}] Failed: ${error.message}`);
        throw error;
      }
    }
  }
  
  console.log('\n✨ Migration complete! Database is ready.');
}

migrate().catch(console.error);
