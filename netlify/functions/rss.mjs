/**
 * RSS Feed for published content
 */
import { getDb } from './lib/db.mjs';

export default async (req) => {
  const sql = getDb();
  const items = await sql`
    SELECT c.id, c.title, c.slug, c.excerpt, c.content_type, c.published_at, c.created_at,
           u.display_name as author_name
    FROM content_items c LEFT JOIN users u ON c.author_id = u.id
    WHERE c.status = 'published'
    ORDER BY COALESCE(c.published_at, c.created_at) DESC LIMIT 20
  `;

  const base = 'https://postlaboreconomics.netlify.app';
  const now = new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Post-Labor Economics</title>
  <link>${base}</link>
  <description>Building the intellectual and policy frameworks for prosperity beyond work.</description>
  <language>en-us</language>
  <lastBuildDate>${now}</lastBuildDate>
  <atom:link href="${base}/api/rss" rel="self" type="application/rss+xml"/>
  ${items.map(i => `<item>
    <title>${esc(i.title)}</title>
    <link>${base}/content-view?id=${i.slug || i.id}</link>
    <guid isPermaLink="true">${base}/content-view?id=${i.slug || i.id}</guid>
    <description>${esc(i.excerpt || '')}</description>
    <author>${esc(i.author_name || 'Anonymous')}</author>
    <category>${esc(i.content_type || 'article')}</category>
    <pubDate>${new Date(i.published_at || i.created_at).toUTCString()}</pubDate>
  </item>`).join('\n  ')}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
  });
};

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export const config = { path: '/api/rss' };
