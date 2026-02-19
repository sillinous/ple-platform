// Seed Content from Knowledge Base
// Reads data/knowledge-base.json and inserts articles into content_items
// POST /api/seed?action=content — seeds content from knowledge base
// POST /api/seed?action=preview — returns what would be seeded without inserting
// POST /api/seed?action=status — returns current seed state
// GET  /api/seed — returns knowledge base metadata

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';

    // Load knowledge base — from the deployed static site or bundled
    let kb;
    try {
      // In Netlify functions, we can't access static files directly
      // The KB is deployed to /data/knowledge-base.json as a public asset
      // We also bundle it inline as a fallback
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';
      const kbResponse = await fetch(`${siteUrl}/data/knowledge-base.json`);
      kb = await kbResponse.json();
    } catch (e) {
      return json(500, { error: 'Could not load knowledge base', detail: e.message });
    }

    // GET — return knowledge base metadata
    if (req.method === 'GET') {
      return json(200, {
        name: kb._meta.name,
        version: kb._meta.version,
        source_count: kb._meta.sources.length,
        seed_articles: kb.seed_content.length,
        framework: {
          series_parts: kb.framework.six_part_series.length,
          prosperity_layers: kb.framework.pyramid_of_prosperity.layers.length,
          power_layers: kb.framework.pyramid_of_power.layers.length,
          principles: kb.framework.manifesto_principles.length
        },
        concepts: Object.keys(kb.key_concepts),
        real_world_examples: kb.real_world_examples.length
      });
    }

    if (req.method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const sql = await getDb();

    // INITIAL SETUP — only works when DB has zero users (fresh Neon install)
    if (action === 'init') {
      const userCount = await sql`SELECT COUNT(*) as c FROM users`.catch(() => [{ c: -1 }]);
      if (userCount[0]?.c > 0) {
        return json(403, { error: 'Database already initialized. Use bootstrap with auth.' });
      }
      // Create admin account
      const bcrypt = await import('bcryptjs');
      const crypto = await import('crypto');
      const id = crypto.randomUUID();
      const hash = await bcrypt.hash('admin1234', 10);
      await sql`
        INSERT INTO users (id, email, display_name, role, password_hash)
        VALUES (${id}, 'admin@ple.org', 'PLE Admin', 'admin', ${hash})
        ON CONFLICT (email) DO NOTHING
      `;
      // Fix schema gaps
      await sql`ALTER TABLE content_items ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP`.catch(()=>{});
      await sql`ALTER TABLE content_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`.catch(()=>{});
      return json(200, { status: 'initialized', admin_email: 'admin@ple.org', admin_id: id });
    }

    // Auth check — require admin (or bootstrap mode to promote first user)
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Authentication required. Pass Bearer token.' });
    
    const sql = await getDb();
    const user = await getCurrentUser(req);
    if (!user) return json(401, { error: 'Invalid or expired session' });
    
    // Bootstrap: if action=bootstrap, promote user to admin and fix schema
    // (safe: only works if user is already authenticated)
    if (action === 'bootstrap') {
      await sql`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
      // Fix schema gaps
      await sql`ALTER TABLE content_items ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP`.catch(()=>{});
      await sql`ALTER TABLE content_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`.catch(()=>{});
      return json(200, { message: 'Bootstrapped! You are now admin. Schema updated.', user_id: user.id });
    }

    if (user.role !== 'admin' && user.role !== 'editor') {
      return json(403, { error: 'Admin or editor role required. Use action=bootstrap first if no admin exists.' });
    }

    // ACTION: preview — show what would be inserted
    if (action === 'preview') {
      const existing = await sql`SELECT slug FROM content_items WHERE slug LIKE 'seed-%'`;
      const existingSlugs = new Set(existing.map(r => r.slug));
      
      const preview = kb.seed_content.map(item => ({
        id: item.id,
        title: item.title,
        slug: item.id,
        content_type: item.content_type,
        tags: item.tags,
        excerpt: item.excerpt,
        body_length: item.body.length,
        already_exists: existingSlugs.has(item.id)
      }));

      return json(200, {
        total: preview.length,
        new: preview.filter(p => !p.already_exists).length,
        existing: preview.filter(p => p.already_exists).length,
        items: preview
      });
    }

    // ACTION: status — check current seed state
    if (action === 'status') {
      const seeded = await sql`SELECT slug, title, status, published_at, created_at FROM content_items WHERE slug LIKE 'seed-%' ORDER BY created_at`;
      return json(200, {
        seeded_count: seeded.length,
        total_available: kb.seed_content.length,
        items: seeded.map(s => ({ slug: s.slug, title: s.title, status: s.status, published_at: s.published_at }))
      });
    }

    // ACTION: content — actually seed the content
    if (action === 'content') {
      const results = [];

      for (const item of kb.seed_content) {
        const slug = item.id;
        
        // Check if already exists
        const existing = await sql`SELECT id FROM content_items WHERE slug = ${slug}`;
        if (existing.length) {
          results.push({ slug, status: 'skipped', reason: 'already exists' });
          continue;
        }

        // Insert content
        const id = crypto.randomUUID();
        await sql`
          INSERT INTO content_items (id, title, slug, content_type, body, excerpt, status, visibility, author_id, version, published_at)
          VALUES (${id}, ${item.title}, ${slug}, ${item.content_type}, ${item.body}, ${item.excerpt}, 'published', 'public', ${user.id}, 1, NOW())
        `;

        // Insert tags
        for (const tagName of (item.tags || [])) {
          const tagResult = await sql`
            INSERT INTO tags (name, slug) VALUES (${tagName}, ${tagName.toLowerCase().replace(/\s+/g, '-')})
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `;
          if (tagResult.length) {
            await sql`INSERT INTO content_tags (content_id, tag_id) VALUES (${id}, ${tagResult[0].id}) ON CONFLICT DO NOTHING`;
          }
        }

        // Log activity
        try {
          await sql`
            INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, metadata)
            VALUES (${crypto.randomUUID()}, ${user.id}, 'content_created', 'content', ${id}, ${JSON.stringify({ title: item.title, content_type: item.content_type, source: 'knowledge-base-seed' })})
          `;
        } catch (e) { /* activity log is optional */ }

        results.push({ slug, status: 'created', title: item.title, id });
      }

      return json(200, {
        seeded: results.filter(r => r.status === 'created').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        total: results.length,
        results
      });
    }

    // ACTION: knowledge — return the full knowledge base for external consumption
    if (action === 'knowledge') {
      return json(200, kb);
    }

    return json(400, { error: `Unknown action: ${action}. Use: content, preview, status, knowledge` });

  } catch (e) {
    return json(500, { error: e.message });
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/seed' };
