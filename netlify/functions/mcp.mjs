// PLE MCP Server — Model Context Protocol endpoint
// GET  /api/mcp — server manifest & tools list
// POST /api/mcp — execute tool calls
import { getDb, jsonResponse } from './lib/db.mjs';

const TOOLS = [
  { name: 'query_knowledge_base', description: 'Query the PLE knowledge base for framework elements, concepts, examples, and statistics.', inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'Topic: framework, pyramid_of_prosperity, pyramid_of_power, four_human_offerings, attractor_states, property_interventions, economic_agency, manifesto, concepts, examples, statistics, sources, all' }, query: { type: 'string', description: 'Optional filter query' } }, required: ['topic'] } },
  { name: 'get_content', description: 'Retrieve published PLE articles. Filter by slug, tag, or search.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, tag: { type: 'string' }, search: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_proposals', description: 'Retrieve PLE policy proposals with vote counts and status.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['draft','open','voting','approved','implemented'] }, limit: { type: 'number' } } } },
  { name: 'get_architecture', description: 'Retrieve GATO alignment architecture elements.', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Element type: attractor, imperative, dimension, relationship' } } } },
  { name: 'search_platform', description: 'Full-text search across all PLE content, proposals, discussions, and KB.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['content','proposals','discussions','kb','all'] } }, required: ['query'] } }
];

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch() });

  try {
    if (req.method === 'GET') {
      return jn(200, { name: 'ple-knowledge-server', version: '2.0.0', description: 'Post-Labor Economics knowledge base & platform. Access PLE framework, articles, proposals, and architecture.', protocol: 'mcp-http', tools: TOOLS, metadata: { author: 'Post-Labor Economics Project', framework_author: 'David Shapiro', site: 'https://postlaboreconomics.netlify.app' } });
    }
    if (req.method !== 'POST') return jn(405, { error: 'Method not allowed' });

    const body = await req.json().catch(() => ({}));
    const toolName = body.tool || body.name || body.method;
    const args = body.arguments || body.params || body.input || {};
    if (!toolName) return jn(400, { error: 'Tool name required. GET /api/mcp for tools.' });

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';
    let kb;
    try { kb = await (await fetch(`${siteUrl}/data/knowledge-base.json`)).json(); } catch (e) { return jn(500, { error: 'KB load failed' }); }

    let result;
    switch (toolName) {
      case 'query_knowledge_base': result = queryKB(kb, args); break;
      case 'get_content': result = await getContent(args); break;
      case 'get_proposals': result = await getProposals(args); break;
      case 'get_architecture': result = await getArch(args); break;
      case 'search_platform': result = await searchAll(kb, args); break;
      default: return jn(400, { error: `Unknown tool: ${toolName}`, available: TOOLS.map(t => t.name) });
    }
    return jn(200, { tool: toolName, result });
  } catch (e) {
    return jn(500, { error: e.message });
  }
}

function queryKB(kb, { topic, query }) {
  const f = query ? new RegExp(query, 'i') : null;
  const fw = kb.framework;
  switch (topic) {
    case 'all': return { framework: fw, key_concepts: kb.key_concepts, real_world_examples: kb.real_world_examples, historical_context: kb.historical_context, meta: kb._meta };
    case 'framework': return { name: fw.name, symbol: fw.symbol, symbol_meaning: fw.symbol_meaning, core_thesis: fw.core_thesis, philosophy: fw.philosophy, tagline: fw.tagline, series: fw.six_part_series.map(s => ({ part: s.part, title: s.title, summary: s.summary })) };
    case 'pyramid_of_prosperity': return fw.pyramid_of_prosperity;
    case 'pyramid_of_power': return fw.pyramid_of_power;
    case 'four_human_offerings': return fw.four_human_offerings || { note: 'Not in this KB version' };
    case 'attractor_states': return fw.attractor_states || { note: 'Not in this KB version' };
    case 'property_interventions': { const p = fw.property_interventions; if (!p) return { note: 'Not available' }; return f ? { ...p, interventions: p.interventions.filter(i => f.test(i.name + i.description + i.category)) } : p; }
    case 'economic_agency': { let p = fw.economic_agency_principles; if (f) p = p.filter(x => f.test(x.name + x.description)); return { principles: p }; }
    case 'manifesto': return { principles: fw.manifesto_principles };
    case 'concepts': { if (f) { const r = {}; for (const [k,v] of Object.entries(kb.key_concepts)) if (f.test(k+v.definition)) r[k]=v; return r; } return kb.key_concepts; }
    case 'examples': { let e = kb.real_world_examples; if (f) e = e.filter(x => f.test(x.name+x.description)); return { examples: e }; }
    case 'statistics': return fw.labor_decline_data || { note: 'Not available' };
    case 'sources': return { sources: kb._meta.sources, count: kb._meta.sources.length };
    default: return { error: `Unknown topic: ${topic}` };
  }
}

async function getContent({ slug, tag, search, limit = 10 }) {
  try {
    const sql = await getDb();
    if (slug) { const r = await sql`SELECT id,title,slug,content_type,body,excerpt,status,published_at FROM content_items WHERE slug=${slug} AND status='published'`; return r[0] || { error: 'Not found' }; }
    if (tag) { return { items: await sql`SELECT c.id,c.title,c.slug,c.excerpt,c.published_at FROM content_items c JOIN content_tags ct ON c.id=ct.content_id JOIN tags t ON ct.tag_id=t.id WHERE t.slug=${tag} AND c.status='published' ORDER BY c.published_at DESC LIMIT ${limit}` }; }
    if (search) { return { items: await sql`SELECT id,title,slug,excerpt,published_at FROM content_items WHERE status='published' AND (title ILIKE ${'%'+search+'%'} OR excerpt ILIKE ${'%'+search+'%'}) ORDER BY published_at DESC LIMIT ${limit}` }; }
    return { items: await sql`SELECT id,title,slug,excerpt,published_at FROM content_items WHERE status='published' ORDER BY published_at DESC LIMIT ${limit}` };
  } catch (e) { return { error: e.message }; }
}

async function getProposals({ status, limit = 10 }) {
  try {
    const sql = await getDb();
    if (status) return { items: await sql`SELECT id,title,slug,description,status,created_at FROM proposals WHERE status=${status} ORDER BY created_at DESC LIMIT ${limit}` };
    return { items: await sql`SELECT id,title,slug,description,status,created_at FROM proposals ORDER BY created_at DESC LIMIT ${limit}` };
  } catch (e) { return { error: e.message }; }
}

async function getArch({ type }) {
  try {
    const sql = await getDb();
    if (type) return { items: await sql`SELECT id,type,code,title,description,status,metadata FROM architecture_elements WHERE type=${type} ORDER BY code` };
    return { items: await sql`SELECT id,type,code,title,description,status,metadata FROM architecture_elements ORDER BY type,code` };
  } catch (e) { return { error: e.message }; }
}

async function searchAll(kb, { query, scope = 'all' }) {
  if (!query) return { error: 'Query required' };
  const q = query.toLowerCase(), results = {};

  if (scope === 'all' || scope === 'kb') {
    const r = [];
    for (const [k,v] of Object.entries(kb.key_concepts)) if ((k+v.definition).toLowerCase().includes(q)) r.push({ type:'concept', key:k, text:v.definition });
    for (const ex of kb.real_world_examples) if ((ex.name+ex.description).toLowerCase().includes(q)) r.push({ type:'example', name:ex.name, text:ex.description });
    if (kb.framework.property_interventions) for (const i of kb.framework.property_interventions.interventions) if ((i.name+i.description).toLowerCase().includes(q)) r.push({ type:'intervention', name:i.name, text:i.description });
    for (const p of kb.framework.manifesto_principles) if ((p.principle+p.description).toLowerCase().includes(q)) r.push({ type:'principle', name:p.principle, text:p.description });
    results.kb = r;
  }

  try {
    const sql = await getDb();
    if (scope === 'all' || scope === 'content') results.content = await sql`SELECT id,title,slug,excerpt FROM content_items WHERE status='published' AND (title ILIKE ${'%'+query+'%'} OR body ILIKE ${'%'+query+'%'}) LIMIT 10`;
    if (scope === 'all' || scope === 'proposals') results.proposals = await sql`SELECT id,title,slug,description FROM proposals WHERE title ILIKE ${'%'+query+'%'} OR description ILIKE ${'%'+query+'%'} LIMIT 10`;
    if (scope === 'all' || scope === 'discussions') results.discussions = await sql`SELECT id,title,slug FROM discussions WHERE title ILIKE ${'%'+query+'%'} OR body ILIKE ${'%'+query+'%'} LIMIT 10`;
  } catch (e) { results.db_error = e.message; }

  return results;
}

function ch() { return { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST,GET,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization' }; }
function jn(s, d) { return new Response(JSON.stringify(d, null, 2), { status: s, headers: { 'Content-Type':'application/json', ...ch() } }); }
