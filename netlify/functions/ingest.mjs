// Substack Ingest — Fetches Shapiro's Substack RSS and discovers new articles
// POST /api/ingest?action=scan    — Scan RSS for new articles not in KB
// POST /api/ingest?action=fetch   — Fetch and summarize a specific article URL
// GET  /api/ingest                — Show current index status

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

const SUBSTACK_RSS = 'https://daveshap.substack.com/feed';
const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';

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
        kb_version: kb._meta?.version
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

    return json(400, { error: `Unknown action: ${action}. Use: scan, fetch` });

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

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
