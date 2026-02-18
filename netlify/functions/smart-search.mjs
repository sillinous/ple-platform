// Smart Search — searches across KB concepts, platform content, proposals, and discussions
// GET /api/smart-search?q=query&scope=all|kb|content|proposals

import { getDb, jsonResponse } from './lib/db.mjs';

const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }
  if (req.method !== 'GET') return json(405, { error: 'GET only' });

  const url = new URL(req.url, 'http://localhost');
  const query = (url.searchParams.get('q') || '').trim();
  const scope = url.searchParams.get('scope') || 'all';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!query) return json(400, { error: 'Query parameter q is required' });

  const results = { query, scope, results: [], kb_matches: [], total: 0 };

  // 1. Search Knowledge Base (always fast — static JSON)
  if (scope === 'all' || scope === 'kb') {
    try {
      const r = await fetch(`${SITE_URL}/data/knowledge-base.json`);
      const kb = await r.json();
      results.kb_matches = searchKB(query, kb);
    } catch (e) { /* KB unavailable */ }
  }

  // 2. Search platform content in DB
  if (scope === 'all' || scope === 'content') {
    try {
      const sql = await getDb();
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        const pattern = words.join('|');
        const content = await sql`
          SELECT id, title, slug, content_type, excerpt, status, published_at,
                 ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body,'')), 
                         plainto_tsquery('english', ${query})) as rank
          FROM content_items
          WHERE status = 'published'
            AND (title ~* ${pattern} OR excerpt ~* ${pattern} OR body ~* ${pattern})
          ORDER BY rank DESC
          LIMIT ${limit}
        `.catch(() => 
          // Fallback without ts_rank if full-text search not available
          sql`SELECT id, title, slug, content_type, excerpt, status, published_at
              FROM content_items
              WHERE status = 'published'
                AND (title ~* ${pattern} OR excerpt ~* ${pattern} OR body ~* ${pattern})
              LIMIT ${limit}`
        );
        for (const c of content) {
          results.results.push({
            type: 'content',
            id: c.id,
            title: c.title,
            slug: c.slug,
            content_type: c.content_type,
            excerpt: c.excerpt,
            url: `/content-view?id=${c.slug || c.id}`,
            rank: c.rank || 0
          });
        }
      }
    } catch (e) { /* DB unavailable */ }
  }

  // 3. Search proposals
  if (scope === 'all' || scope === 'proposals') {
    try {
      const sql = await getDb();
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        const pattern = words.join('|');
        const proposals = await sql`
          SELECT id, title, description, status, vote_count
          FROM proposals
          WHERE title ~* ${pattern} OR description ~* ${pattern}
          LIMIT ${Math.floor(limit / 2)}
        `;
        for (const p of proposals) {
          results.results.push({
            type: 'proposal',
            id: p.id,
            title: p.title,
            excerpt: p.description?.substring(0, 200),
            status: p.status,
            votes: p.vote_count,
            url: `/proposal-view?id=${p.id}`
          });
        }
      }
    } catch (e) { /* proposals table may not exist */ }
  }

  // 4. Search discussions
  if (scope === 'all' || scope === 'discussions') {
    try {
      const sql = await getDb();
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (words.length > 0) {
        const pattern = words.join('|');
        const discussions = await sql`
          SELECT id, title, body, category
          FROM discussions
          WHERE title ~* ${pattern} OR body ~* ${pattern}
          LIMIT ${Math.floor(limit / 3)}
        `;
        for (const d of discussions) {
          results.results.push({
            type: 'discussion',
            id: d.id,
            title: d.title,
            excerpt: d.body?.substring(0, 200),
            category: d.category,
            url: `/discussion-view?id=${d.id}`
          });
        }
      }
    } catch (e) { /* discussions table may not exist */ }
  }

  results.total = results.results.length + results.kb_matches.length;
  return json(200, results);
}

function searchKB(query, kb) {
  const q = query.toLowerCase();
  const matches = [];

  // Search concepts
  for (const [key, val] of Object.entries(kb.key_concepts || {})) {
    if (key.includes(q.replace(/\s+/g, '_')) || val.toLowerCase().includes(q)) {
      matches.push({
        type: 'concept',
        key: key.replace(/_/g, ' '),
        description: val,
        relevance: 'high'
      });
    }
  }

  // Search pyramid of prosperity layers
  for (const layer of (kb.framework?.pyramid_of_prosperity?.layers || [])) {
    const text = `${layer.name} ${layer.description} ${(layer.examples || []).join(' ')}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'prosperity_layer',
        level: layer.level,
        name: layer.name,
        description: layer.description,
        examples: layer.examples,
        relevance: 'high'
      });
    }
  }

  // Search pyramid of power layers
  for (const layer of (kb.framework?.pyramid_of_power?.layers || [])) {
    const text = `${layer.name} ${layer.description}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'power_layer',
        level: layer.level,
        name: layer.name,
        description: layer.description,
        relevance: 'high'
      });
    }
  }

  // Search real-world examples
  for (const ex of (kb.real_world_examples || [])) {
    const text = `${ex.name} ${ex.type} ${ex.description}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'example',
        name: ex.name,
        category: ex.type,
        description: ex.description,
        relevance: 'medium'
      });
    }
  }

  // Search six-part series
  for (const part of (kb.framework?.six_part_series || [])) {
    const text = `${part.title} ${part.summary} ${part.key_insight}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'series_part',
        part: part.part,
        title: part.title,
        summary: part.summary,
        key_insight: part.key_insight,
        relevance: 'high'
      });
    }
  }

  // Search economic agency principles
  for (const p of (kb.framework?.economic_agency_principles || [])) {
    const text = `${p.name} ${p.description}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'principle',
        name: p.name,
        description: p.description,
        relevance: 'medium'
      });
    }
  }

  // Search historical context
  for (const h of (kb.historical_context || [])) {
    const text = `${h.era} ${h.description}`.toLowerCase();
    if (q.split(/\s+/).some(w => w.length > 2 && text.includes(w))) {
      matches.push({
        type: 'historical',
        era: h.era,
        description: h.description,
        relevance: 'low'
      });
    }
  }

  // Search substack index
  for (const a of (kb.substack_index?.known_articles || [])) {
    if (a.title.toLowerCase().includes(q) || q.split(/\s+/).some(w => w.length > 3 && a.title.toLowerCase().includes(w))) {
      matches.push({
        type: 'substack',
        title: a.title,
        url: a.url,
        date: a.date,
        relevance: 'medium'
      });
    }
  }

  return matches;
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/smart-search' };
