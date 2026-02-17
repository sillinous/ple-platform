import { getDb, jsonResponse } from './lib/db.mjs';

export default async (req) => {
  try {
    const sql = await getDb();
    const base = 'https://postlaboreconomics.netlify.app';
    const now = new Date().toISOString().split('T')[0];
    
    // Static pages
    const pages = [
      { loc: '', priority: '1.0', freq: 'daily' },
      { loc: '/about', priority: '0.8', freq: 'monthly' },
      { loc: '/content', priority: '0.9', freq: 'daily' },
      { loc: '/projects', priority: '0.8', freq: 'weekly' },
      { loc: '/proposals', priority: '0.8', freq: 'weekly' },
      { loc: '/discussions', priority: '0.8', freq: 'daily' },
      { loc: '/community', priority: '0.7', freq: 'weekly' },
      { loc: '/tags', priority: '0.7', freq: 'weekly' },
      { loc: '/glossary', priority: '0.6', freq: 'monthly' },
      { loc: '/series', priority: '0.7', freq: 'weekly' },
      { loc: '/activity', priority: '0.5', freq: 'daily' },
      { loc: '/search', priority: '0.6', freq: 'monthly' },
      { loc: '/api-docs', priority: '0.5', freq: 'monthly' },
    ];

    // Dynamic: published content
    const content = await sql`SELECT slug, id, updated_at FROM content_items WHERE status = 'published' ORDER BY updated_at DESC`;
    content.forEach(c => pages.push({ loc: `/content-view?id=${c.slug || c.id}`, priority: '0.7', freq: 'monthly', lastmod: c.updated_at }));
    
    // Dynamic: projects
    const projects = await sql`SELECT slug, id, updated_at FROM projects ORDER BY updated_at DESC`;
    projects.forEach(p => pages.push({ loc: `/project-view?id=${p.slug || p.id}`, priority: '0.6', freq: 'weekly', lastmod: p.updated_at }));

    // Dynamic: open proposals
    const props = await sql`SELECT id, updated_at FROM proposals WHERE status IN ('open','accepted','implemented') ORDER BY updated_at DESC`;
    props.forEach(p => pages.push({ loc: `/proposal-view?id=${p.id}`, priority: '0.5', freq: 'weekly', lastmod: p.updated_at }));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${base}${p.loc}</loc>
    ${p.lastmod ? `<lastmod>${new Date(p.lastmod).toISOString().split('T')[0]}</lastmod>` : `<lastmod>${now}</lastmod>`}
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch(e) {
    return new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      status: 500, headers: { 'Content-Type': 'application/xml' }
    });
  }
};

export const config = { path: '/sitemap.xml' };
