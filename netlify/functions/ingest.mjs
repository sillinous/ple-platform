// Substack Ingest + Composio-Powered Discovery
// POST /api/ingest?action=scan      — Scan RSS for new articles not in KB
// POST /api/ingest?action=fetch     — Fetch and summarize a specific article URL
// POST /api/ingest?action=discover  — [COMPOSIO] Search HN + News for PLE discourse
// POST /api/ingest?action=academic  — [COMPOSIO] Search Semantic Scholar for PLE papers
// GET  /api/ingest                  — Show current index status
//
// NOTE: Composio API is used for dev/admin discovery only — never exposed to end users.
// Composio key is stored as COMPOSIO_API_KEY env var (server-side only).

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

const SUBSTACK_RSS = 'https://daveshap.substack.com/feed';
const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';
const COMPOSIO_API = 'https://backend.composio.dev/api/v3';
const COMPOSIO_USER = 'ple-dev-ingest';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';

    // GET — status
    if (req.method === 'GET') {
      let kb;
      try {
        const r = await fetch(`${SITE_URL}/data/knowledge-base.json`);
        kb = await r.json();
      } catch (e) {
        return json(500, { error: 'Could not load KB' });
      }
      const indexed = kb.substack_index?.known_articles || [];
      return json(200, {
        status: 'ready',
        rss_url: SUBSTACK_RSS,
        indexed_count: indexed.length,
        latest_indexed: indexed.length > 0 ? indexed[0] : null,
        kb_version: kb._meta?.version,
        composio: {
          configured: !!process.env.COMPOSIO_API_KEY,
          actions: ['discover (HN + News + Web search)', 'academic (Semantic Scholar)'],
          note: '[COMPOSIO] Dev-only — not exposed to end users'
        },
        actions: ['scan (RSS)', 'fetch (article URL)', 'discover [COMPOSIO]', 'academic [COMPOSIO]']
      });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    // Auth check
    const user = await getCurrentUser(req);
    if (!user) return json(401, { error: 'Authentication required' });
    if (user.role !== 'admin' && user.role !== 'editor') {
      return json(403, { error: 'Admin or editor role required' });
    }

    // ACTION: scan — fetch RSS and find new articles
    if (action === 'scan') {
      // Fetch RSS feed
      let rssText;
      try {
        const rssResponse = await fetch(SUBSTACK_RSS, {
          headers: { 'User-Agent': 'PLE-Platform/2.0 (Post-Labor Economics Knowledge Indexer)' }
        });
        rssText = await rssResponse.text();
      } catch (e) {
        return json(502, { error: 'Could not fetch Substack RSS', detail: e.message });
      }

      // Parse RSS (simple XML extraction)
      const items = parseRSS(rssText);

      // Load current KB to check what's already indexed
      let kb;
      try {
        const r = await fetch(`${SITE_URL}/data/knowledge-base.json`);
        kb = await r.json();
      } catch (e) {
        return json(500, { error: 'Could not load KB' });
      }

      const indexedUrls = new Set((kb.substack_index?.known_articles || []).map(a => a.url));

      // Filter to PLE-related articles
      const pleKeywords = ['post-labor', 'ple', 'automation', 'labor', 'ubi', 'pyramid', 'l/0', 'labor zero', 'labor/zero', 'prosperity', 'decoupling', 'economic', 'neoliberal', 'social contract'];
      
      const newArticles = [];
      const allArticles = [];

      for (const item of items) {
        const text = `${item.title} ${item.description || ''}`.toLowerCase();
        const isPLE = pleKeywords.some(k => text.includes(k));
        
        allArticles.push({
          title: item.title,
          url: item.link,
          date: item.pubDate,
          is_ple_related: isPLE,
          already_indexed: indexedUrls.has(item.link)
        });

        if (isPLE && !indexedUrls.has(item.link)) {
          newArticles.push({
            title: item.title,
            url: item.link,
            date: item.pubDate,
            description: item.description?.substring(0, 300)
          });
        }
      }

      try {
        await logActivity(user.id, 'substack_scan', 'ingest', null, {
          total_feed_items: items.length,
          ple_related: allArticles.filter(a => a.is_ple_related).length,
          new_articles: newArticles.length
        });
      } catch (e) { /* logging optional */ }

      return json(200, {
        feed_items: items.length,
        ple_related: allArticles.filter(a => a.is_ple_related).length,
        already_indexed: allArticles.filter(a => a.already_indexed).length,
        new_articles: newArticles,
        all_articles: allArticles
      });
    }

    // ACTION: fetch — fetch a specific article and extract content
    if (action === 'fetch') {
      const body = await req.json();
      const articleUrl = body.url;
      if (!articleUrl) return json(400, { error: 'URL is required in request body' });

      let html;
      try {
        const response = await fetch(articleUrl, {
          headers: { 'User-Agent': 'PLE-Platform/2.0' }
        });
        html = await response.text();
      } catch (e) {
        return json(502, { error: 'Could not fetch article', detail: e.message });
      }

      // Extract content from Substack HTML
      const extracted = extractSubstackContent(html);

      return json(200, {
        url: articleUrl,
        ...extracted,
        note: 'Use this data to create a seed article or update the knowledge base manually'
      });
    }

    // ACTION: discover — [COMPOSIO] Search HN + News for PLE-relevant discourse
    // Dev-only: uses Composio API for cross-platform content discovery
    if (action === 'discover') {
      const composioKey = process.env.COMPOSIO_API_KEY;
      if (!composioKey) {
        return json(503, { error: '[COMPOSIO] Not configured. Set COMPOSIO_API_KEY env var.', provider: 'composio' });
      }

      const body = await req.json().catch(() => ({}));
      const query = body.query || 'post-labor economics automation UBI';
      const sources = body.sources || ['hackernews', 'news'];

      const results = { query, sources: [], provider: 'composio', timestamp: new Date().toISOString() };

      // [COMPOSIO] HackerNews search
      if (sources.includes('hackernews')) {
        try {
          const hnData = await composioExecute(composioKey, 'HACKERNEWS_SEARCH_POSTS', { query, size: 10 });
          // Parse response — Composio wraps data differently
          let posts = [];
          const raw = hnData?.data;
          // Composio wraps HN response in { response_data: ... }
          let innerData = raw;
          if (raw?.response_data) innerData = raw.response_data;
          if (typeof innerData === 'string') {
            try { const parsed = JSON.parse(innerData); posts = parsed?.hits || parsed?.results || parsed || []; } catch(e) { posts = []; }
          } else if (innerData?.hits) {
            posts = innerData.hits;
          } else if (innerData?.results) {
            posts = innerData.results;
          } else if (Array.isArray(innerData)) {
            posts = innerData;
          }
          results.sources.push({
            name: 'hackernews',
            provider: '[COMPOSIO]',
            count: posts.length,
            items: posts.slice(0, 10).map(p => ({
              title: p.title || p.story_title || '',
              url: p.url || p.story_url || `https://news.ycombinator.com/item?id=${p.objectID || p.id || ''}`,
              points: p.points || p.score || 0,
              date: p.created_at || '',
              comments: p.num_comments || 0,
              author: p.author || ''
            })),
            _debug_keys: raw ? (typeof raw === 'object' ? Object.keys(raw) : typeof raw) : 'null'
          });
        } catch (e) {
          results.sources.push({ name: 'hackernews', provider: '[COMPOSIO]', error: e.message, _debug: e.toString() });
        }
      }

      // [COMPOSIO] News search  
      if (sources.includes('news')) {
        try {
          const newsData = await composioExecute(composioKey, 'COMPOSIO_SEARCH_NEWS_SEARCH', { query: query + ' economics' });
          // Composio response format varies — try multiple paths
          const rawNews = newsData?.data || newsData;
          const articles = rawNews?.results || rawNews?.news_results || rawNews?.organic_results || 
            (Array.isArray(rawNews) ? rawNews : []);
          results.sources.push({
            name: 'news',
            provider: '[COMPOSIO]',
            count: Array.isArray(articles) ? articles.length : 0,

            items: Array.isArray(articles) ? articles.slice(0, 10).map(a => ({
              title: a.title || '',
              url: a.link || a.url || '',
              source: a.source || '',
              snippet: (a.snippet || a.description || '').substring(0, 200),
              date: a.date || ''
            })) : []
          });
        } catch (e) {
          results.sources.push({ name: 'news', provider: '[COMPOSIO]', error: e.message });
        }
      }

      // [COMPOSIO] DuckDuckGo search
      if (sources.includes('web')) {
        try {
          const webData = await composioExecute(composioKey, 'COMPOSIO_SEARCH_DUCK_DUCK_GO_SEARCH', { query });
          const rawWeb = webData?.data || webData;
          // DDG response: { response_data: { ads: [...], results: [...] } }
          const rd = rawWeb?.response_data || rawWeb;
          const webResults = rd?.results || rd?.organic_results || 
            (Array.isArray(rd) ? rd : []);
          results.sources.push({
            name: 'web',
            provider: '[COMPOSIO]',
            count: Array.isArray(webResults) ? webResults.length : 0,

            items: Array.isArray(webResults) ? webResults.slice(0, 10).map(r => ({
              title: r.title || '',
              url: r.link || r.href || r.url || '',
              snippet: (r.snippet || r.body || r.description || '').substring(0, 200)
            })) : []
          });
        } catch (e) {
          results.sources.push({ name: 'web', provider: '[COMPOSIO]', error: e.message });
        }
      }

      try {
        await logActivity(user.id, 'composio_discover', 'ingest', null, {
          query, source_count: results.sources.length, provider: 'composio'
        });
      } catch (e) {}

      return json(200, results);
    }

    // ACTION: academic — [COMPOSIO] Search Semantic Scholar for PLE-relevant papers
    if (action === 'academic') {
      const composioKey = process.env.COMPOSIO_API_KEY;
      if (!composioKey) {
        return json(503, { error: '[COMPOSIO] Not configured. Set COMPOSIO_API_KEY env var.', provider: 'composio' });
      }

      const body = await req.json().catch(() => ({}));
      const query = body.query || 'post-labor economics automation universal basic income';

      try {
        // [COMPOSIO] Semantic Scholar paper search
        // Note: Requires a connected Semantic Scholar account in Composio dashboard
        const data = await composioExecute(composioKey, 'SEMANTICSCHOLAR_PAPER_RELEVANCE_SEARCH', {
          query,
          limit: body.limit || 10
        });

        const rawPapers = data?.data || data;
        const papers = rawPapers?.data || rawPapers?.results || rawPapers?.papers || 
          (Array.isArray(rawPapers) ? rawPapers : []);

        const result = {
          query,
          provider: '[COMPOSIO] Semantic Scholar',
          count: Array.isArray(papers) ? papers.length : 0,
          raw_keys: typeof rawPapers === 'object' ? Object.keys(rawPapers || {}).slice(0, 10) : typeof rawPapers,
          papers: Array.isArray(papers) ? papers.map(p => ({
            title: p.title || '',
            authors: Array.isArray(p.authors) ? p.authors.map(a => a.name || a).join(', ') : '',
            year: p.year || '',
            citations: p.citationCount || 0,
            abstract: (p.abstract || '').substring(0, 300),
            url: p.url || ''
          })) : [],
          timestamp: new Date().toISOString()
        };

        try {
          await logActivity(user.id, 'composio_academic', 'ingest', null, {
            query, paper_count: result.count, provider: 'composio'
          });
        } catch (e) {}

        return json(200, result);
      } catch (e) {
        const isNoConnection = e.message.includes('ConnectedAccountNotFound');
        return json(isNoConnection ? 200 : 502, { 
          error: isNoConnection 
            ? '[COMPOSIO] Semantic Scholar needs a connected account. Set up at composio.dev dashboard.' 
            : `[COMPOSIO] Semantic Scholar error: ${e.message}`,
          provider: 'composio',
          setup_url: isNoConnection ? 'https://app.composio.dev/apps/semanticscholar' : undefined,
          query
        });
      }
    }

    return json(400, { error: `Unknown action: ${action}. Use: scan, fetch, discover, academic` });

  } catch (e) {
    return json(500, { error: e.message });
  }
}

// Simple RSS parser (no external dependencies)
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title'),
      link: extractTag(itemXml, 'link'),
      pubDate: extractTag(itemXml, 'pubDate'),
      description: extractTag(itemXml, 'description'),
      creator: extractTag(itemXml, 'dc:creator')
    });
  }
  return items;
}

function extractTag(xml, tag) {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's');
  const m = xml.match(regex);
  return m ? m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : '';
}

function extractSubstackContent(html) {
  // Extract title
  const titleMatch = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>(.*?)<\/h1>/s) 
    || html.match(/<title>(.*?)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Unknown';

  // Extract subtitle
  const subtitleMatch = html.match(/<h3[^>]*class="[^"]*subtitle[^"]*"[^>]*>(.*?)<\/h3>/s);
  const subtitle = subtitleMatch ? subtitleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Extract date
  const dateMatch = html.match(/<time[^>]*datetime="([^"]*)"/) || html.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

  // Extract body text (rough extraction)
  const bodyMatch = html.match(/<div[^>]*class="[^"]*body markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  let bodyText = '';
  if (bodyMatch) {
    bodyText = bodyMatch[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract word count
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    title,
    subtitle,
    date,
    word_count: wordCount,
    excerpt: bodyText.substring(0, 500),
    full_text_length: bodyText.length
  };
}

// [COMPOSIO] Execute a tool via Composio API — dev/admin only
async function composioExecute(apiKey, toolSlug, parameters) {
  const response = await fetch(`${COMPOSIO_API}/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ arguments: parameters, user_id: COMPOSIO_USER })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`[COMPOSIO] ${toolSlug} failed: ${response.status} ${errText.substring(0, 200)}`);
  }

  const result = await response.json();
  // Attach raw response shape for debugging
  result._composio_debug = {
    status: response.status,
    successful: result?.successful,
    data_type: typeof result?.data,
    data_keys: result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? Object.keys(result.data) : null
  };
  return result;
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/ingest' };
