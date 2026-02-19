// Auto-Ingest Pipeline — Scheduled KB enrichment
// Runs on schedule (weekly) or manually via POST /api/auto-ingest
//
// Pipeline:
// 1. Scan Shapiro's Substack RSS for new articles
// 2. [COMPOSIO] Search HackerNews for PLE-relevant discussions
// 3. [COMPOSIO] Search web for new PLE-related content
// 4. Store results in DB as "discovery queue" for admin review
//
// NOTE: Composio API is used for dev discovery only — never auto-publishes.
// All discovered content goes to a review queue, not directly to KB.

import { getDb, logActivity, jsonResponse } from './lib/db.mjs';

const SUBSTACK_RSS = 'https://daveshap.substack.com/feed';
const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';
const COMPOSIO_API = 'https://backend.composio.dev/api/v3';
const COMPOSIO_USER = 'ple-auto-ingest';

const PLE_KEYWORDS = [
  'post-labor', 'post labor', 'ple framework', 'labor zero', 'l/0',
  'automation economy', 'ai jobs', 'job displacement', 'universal basic income',
  'ubi', 'technofeudalism', 'decoupling labor', 'prosperity beyond work',
  'david shapiro', 'property interventions', 'economic agency',
  'ai replacing', 'ai economy', 'future of work', 'post-work',
  'automation unemployment', 'technological unemployment', 'robot tax',
  'wealth inequality', 'ai dividend', 'machine labor',
  'solarpunk', 'techno-abundance', 'labor disruption'
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }

  // GET — show pipeline status and recent discoveries
  if (req.method === 'GET') {
    try {
      const db = await getDb();
      const discoveries = await db`
        SELECT id, source, title, url, relevance_score, status, discovered_at
        FROM discovery_queue
        ORDER BY discovered_at DESC LIMIT 20
      `.catch(() => []);

      const stats = await db`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed,
          COUNT(*) as total,
          MAX(discovered_at) as last_run
        FROM discovery_queue
      `.catch(() => [{ pending: 0, approved: 0, dismissed: 0, total: 0, last_run: null }]);

      return json(200, {
        status: 'ready',
        composio_configured: !!process.env.COMPOSIO_API_KEY,
        schedule: 'Weekly (or manual POST)',
        stats: stats[0] || {},
        recent_discoveries: discoveries,
        actions: {
          run: 'POST /api/auto-ingest — Run pipeline now',
          review: 'POST /api/auto-ingest?action=review — List pending items',
          approve: 'POST /api/auto-ingest?action=approve&id=<id> — Approve for KB',
          dismiss: 'POST /api/auto-ingest?action=dismiss&id=<id> — Dismiss item'
        }
      });
    } catch (e) {
      return json(200, {
        status: 'needs_setup',
        message: 'Discovery queue table not yet created. Run POST to initialize.',
        composio_configured: !!process.env.COMPOSIO_API_KEY
      });
    }
  }

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'run';

  const db = await getDb();

  // Ensure discovery_queue table exists
  await db`
    CREATE TABLE IF NOT EXISTS discovery_queue (
      id SERIAL PRIMARY KEY,
      source VARCHAR(50) NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      snippet TEXT,
      author VARCHAR(200),
      relevance_score REAL DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pending',
      discovered_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP,
      reviewed_by UUID
    )
  `.catch(() => {});

  // Create index for deduplication
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_url ON discovery_queue(url) WHERE url IS NOT NULL
  `.catch(() => {});

  // ACTION: run — execute the full pipeline
  if (action === 'run') {
    const results = { timestamp: new Date().toISOString(), sources: [], new_items: 0, skipped: 0 };

    // 1. Substack RSS scan
    try {
      const rssRes = await fetch(SUBSTACK_RSS, {
        headers: { 'User-Agent': 'PLE-AutoIngest/1.0' }
      });
      const rssText = await rssRes.text();
      const items = parseRSS(rssText);

      let rssNew = 0;
      for (const item of items) {
        // All Shapiro Substack articles are PLE-relevant (primary source)
        // For other RSS feeds, would apply keyword filtering
        try {
          await db`
            INSERT INTO discovery_queue (source, title, url, snippet, author, relevance_score, metadata)
            VALUES ('substack_rss', ${item.title}, ${item.link}, ${(item.description || '').substring(0, 500)}, 
                    ${item.creator || 'David Shapiro'}, 0.9,
                    ${JSON.stringify({ date: item.pubDate, source_type: 'primary' })})
            ON CONFLICT (url) DO NOTHING
          `;
          rssNew++;
        } catch (e) { /* duplicate */ }
      }
      results.sources.push({ name: 'substack_rss', total: items.length, new: rssNew });
      results.new_items += rssNew;
    } catch (e) {
      results.sources.push({ name: 'substack_rss', error: e.message });
    }

    // 2. [COMPOSIO] HackerNews search
    const composioKey = process.env.COMPOSIO_API_KEY;
    if (composioKey) {
      try {
        const queries = ['post-labor economics', 'universal basic income automation', 'AI job displacement economy'];
        let hnNew = 0;

        for (const q of queries) {
          const data = await composioExecute(composioKey, 'HACKERNEWS_SEARCH_POSTS', { query: q, size: 5 });
          const posts = data?.data?.results || data?.data?.hits || [];
          if (!Array.isArray(posts)) continue;

          for (const p of posts) {
            const title = p.title || p.story_title || '';
            const postUrl = p.url || p.story_url || `https://news.ycombinator.com/item?id=${p.objectID || p.id || ''}`;
            if (!title) continue;

            // Score by engagement
            const score = Math.min(1, ((p.points || 0) + (p.num_comments || 0) * 2) / 200);

            try {
              await db`
                INSERT INTO discovery_queue (source, title, url, snippet, author, relevance_score, metadata)
                VALUES ('hackernews', ${title}, ${postUrl}, ${''}, ${p.author || ''},
                        ${Math.round(score * 100) / 100},
                        ${JSON.stringify({ points: p.points, comments: p.num_comments, query: q, provider: 'composio' })})
                ON CONFLICT (url) DO NOTHING
              `;
              hnNew++;
            } catch (e) { /* duplicate */ }
          }
        }
        results.sources.push({ name: 'hackernews [COMPOSIO]', new: hnNew });
        results.new_items += hnNew;
      } catch (e) {
        results.sources.push({ name: 'hackernews [COMPOSIO]', error: e.message });
      }

      // 3. [COMPOSIO] Web search
      try {
        const webData = await composioExecute(composioKey, 'COMPOSIO_SEARCH_DUCK_DUCK_GO_SEARCH', {
          query: 'post-labor economics David Shapiro 2025 2026'
        });
        const rd = webData?.data?.response_data || webData?.data || {};
        const webResults = rd?.results || [];
        let webNew = 0;

        if (Array.isArray(webResults)) {
          for (const r of webResults) {
            const title = r.title || '';
            const link = r.link || r.href || r.url || '';
            if (!title || !link) continue;
            // Skip our own site
            if (link.includes('postlaboreconomics.netlify.app')) continue;

            try {
              await db`
                INSERT INTO discovery_queue (source, title, url, snippet, relevance_score, metadata)
                VALUES ('web_search', ${title}, ${link}, ${(r.body || r.snippet || '').substring(0, 500)},
                        0.5, ${JSON.stringify({ provider: 'composio', search_type: 'ddg' })})
                ON CONFLICT (url) DO NOTHING
              `;
              webNew++;
            } catch (e) { /* duplicate */ }
          }
        }
        results.sources.push({ name: 'web_search [COMPOSIO]', new: webNew });
        results.new_items += webNew;
      } catch (e) {
        results.sources.push({ name: 'web_search [COMPOSIO]', error: e.message });
      }
    } else {
      results.sources.push({ name: '[COMPOSIO] skipped', reason: 'COMPOSIO_API_KEY not set' });
    }

    results.skipped = results.sources.reduce((sum, s) => sum + (s.total || 0), 0) - results.new_items;

    try {
      await logActivity(null, 'auto_ingest_run', 'system', null, results);
    } catch (e) {}

    return json(200, results);
  }

  // ACTION: review — list pending items
  if (action === 'review') {
    const pending = await db`
      SELECT * FROM discovery_queue
      WHERE status = 'pending'
      ORDER BY relevance_score DESC, discovered_at DESC
      LIMIT 50
    `;
    return json(200, { count: pending.length, items: pending });
  }

  // ACTION: approve/dismiss
  if (action === 'approve' || action === 'dismiss') {
    const id = url.searchParams.get('id');
    if (!id) return json(400, { error: 'id parameter required' });

    const newStatus = action === 'approve' ? 'approved' : 'dismissed';
    const result = await db`
      UPDATE discovery_queue 
      SET status = ${newStatus}, reviewed_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, status
    `;

    if (result.length === 0) return json(404, { error: 'Item not found' });
    return json(200, { updated: result[0] });
  }

  return json(400, { error: `Unknown action: ${action}. Use: run, review, approve, dismiss` });
}

// RSS parser
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const x = match[1];
    items.push({
      title: extractTag(x, 'title'),
      link: extractTag(x, 'link'),
      pubDate: extractTag(x, 'pubDate'),
      description: extractTag(x, 'description'),
      creator: extractTag(x, 'dc:creator')
    });
  }
  return items;
}

function extractTag(xml, tag) {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const m1 = xml.match(cdata);
  if (m1) return m1[1].trim();
  const m2 = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's'));
  return m2 ? m2[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : '';
}

// [COMPOSIO] Tool executor
async function composioExecute(apiKey, toolSlug, args) {
  const res = await fetch(`${COMPOSIO_API}/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ arguments: args, user_id: COMPOSIO_USER })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`[COMPOSIO] ${toolSlug}: ${res.status} ${err.substring(0, 200)}`);
  }
  return await res.json();
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { 
  path: '/api/auto-ingest'
};
// v1771509554
