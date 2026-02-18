// MCP Server — Exposes PLE Knowledge Base via Model Context Protocol
// Allows external AI agents (Claude, ChatGPT, etc.) to query PLE data
//
// GET  /api/mcp — Server manifest (tools list)
// POST /api/mcp — Execute tool calls
//
// Tools exposed:
//   ple_search          — Search across KB concepts, content, examples
//   ple_get_framework   — Get full framework (pyramids, series, principles)
//   ple_get_concept     — Get a specific concept definition
//   ple_get_examples    — Get real-world examples, optionally filtered
//   ple_get_content     — Get published platform content
//   ple_get_metrics     — Get KPIs and measurement framework
//   ple_substack_index  — Get index of Shapiro's Substack articles

import { getDb, jsonResponse } from './lib/db.mjs';

const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';

let _kb = null;
async function loadKB() {
  if (_kb) return _kb;
  try {
    const r = await fetch(`${SITE_URL}/data/knowledge-base.json`);
    _kb = await r.json();
    return _kb;
  } catch (e) {
    return null;
  }
}

// Tool definitions
const TOOLS = [
  {
    name: 'ple_search',
    description: 'Search the Post-Labor Economics knowledge base across all concepts, framework elements, real-world examples, and published content. Returns matched items with descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — topic, concept, or keyword' },
        scope: { type: 'string', enum: ['all', 'concepts', 'framework', 'examples', 'content'], description: 'Narrow search scope', default: 'all' }
      },
      required: ['query']
    }
  },
  {
    name: 'ple_get_framework',
    description: 'Get the complete PLE framework: Pyramid of Prosperity (5-layer income framework), Pyramid of Power (5-layer democratic resilience), six-part series overview, manifesto principles, and economic agency principles.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['all', 'prosperity', 'power', 'series', 'principles', 'manifesto', 'agency'], description: 'Which framework section to return', default: 'all' }
      }
    }
  },
  {
    name: 'ple_get_concept',
    description: 'Get the definition of a specific PLE concept. Available concepts: labor_zero, great_decoupling, four_human_offerings, structured_optimism, solarpunk_future, economic_agency_paradox, investment_based_future, universal_asset_tokenization, labor_sacralization, sixteen_income_streams.',
    inputSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'Concept key (e.g., "labor_zero", "great_decoupling") or natural language name' }
      },
      required: ['concept']
    }
  },
  {
    name: 'ple_get_examples',
    description: 'Get real-world examples of post-labor economics in action. Includes Alaska Permanent Fund, Mondragon Corporation, Nordic Model, Finland UBI experiment, 16 Income Streams, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: sovereign_wealth, cooperative, social_democracy, ubi_trial, employee_ownership, banking_integration, infrastructure, etc.' }
      }
    }
  },
  {
    name: 'ple_get_content',
    description: 'Get published articles, policy briefs, and reports from the PLE platform.',
    inputSchema: {
      type: 'object',
      properties: {
        content_type: { type: 'string', enum: ['article', 'policy_brief', 'report', 'internal_doc'], description: 'Filter by content type' },
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 }
      }
    }
  },
  {
    name: 'ple_get_metrics',
    description: 'Get the KPI and measurement framework for tracking the post-labor transition: productivity-wage gap, automation displacement rate, labor share of GDP, ownership breadth index, democratic resilience metrics.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'ple_substack_index',
    description: 'Get the index of David Shapiro\'s Substack articles on Post-Labor Economics, with titles, URLs, and dates. Useful for finding source material.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// Tool handlers
async function handleTool(name, input) {
  const kb = await loadKB();
  if (!kb) return { error: 'Knowledge base unavailable' };

  switch (name) {
    case 'ple_search': return handleSearch(kb, input);
    case 'ple_get_framework': return handleFramework(kb, input);
    case 'ple_get_concept': return handleConcept(kb, input);
    case 'ple_get_examples': return handleExamples(kb, input);
    case 'ple_get_content': return await handleContent(input);
    case 'ple_get_metrics': return handleMetrics(kb);
    case 'ple_substack_index': return handleSubstack(kb);
    default: return { error: `Unknown tool: ${name}` };
  }
}

function handleSearch(kb, { query, scope = 'all' }) {
  const q = query.toLowerCase();
  const results = [];

  if (scope === 'all' || scope === 'concepts') {
    for (const [key, val] of Object.entries(kb.key_concepts)) {
      if (key.includes(q.replace(/\s+/g, '_')) || val.toLowerCase().includes(q)) {
        results.push({ type: 'concept', key, definition: val });
      }
    }
  }

  if (scope === 'all' || scope === 'framework') {
    for (const part of kb.framework.six_part_series) {
      if (`${part.title} ${part.summary} ${part.key_insight}`.toLowerCase().includes(q)) {
        results.push({ type: 'series', part: part.part, title: part.title, summary: part.summary });
      }
    }
    for (const layer of kb.framework.pyramid_of_prosperity.layers) {
      if (`${layer.name} ${layer.description} ${(layer.examples||[]).join(' ')}`.toLowerCase().includes(q)) {
        results.push({ type: 'prosperity_layer', level: layer.level, name: layer.name, description: layer.description });
      }
    }
    for (const layer of kb.framework.pyramid_of_power.layers) {
      if (`${layer.name} ${layer.description}`.toLowerCase().includes(q)) {
        results.push({ type: 'power_layer', level: layer.level, name: layer.name, description: layer.description });
      }
    }
  }

  if (scope === 'all' || scope === 'examples') {
    for (const ex of kb.real_world_examples) {
      if (`${ex.name} ${ex.type} ${ex.description}`.toLowerCase().includes(q)) {
        results.push({ type: 'example', name: ex.name, category: ex.type, description: ex.description });
      }
    }
  }

  return { query, results_count: results.length, results };
}

function handleFramework(kb, { section = 'all' } = {}) {
  const f = kb.framework;
  const result = {};

  if (section === 'all' || section === 'prosperity') {
    result.pyramid_of_prosperity = f.pyramid_of_prosperity;
  }
  if (section === 'all' || section === 'power') {
    result.pyramid_of_power = f.pyramid_of_power;
  }
  if (section === 'all' || section === 'series') {
    result.six_part_series = f.six_part_series;
  }
  if (section === 'all' || section === 'principles' || section === 'manifesto') {
    result.manifesto_principles = f.manifesto_principles;
  }
  if (section === 'all' || section === 'agency') {
    result.economic_agency_principles = f.economic_agency_principles;
  }

  result.core = {
    name: f.name,
    symbol: f.symbol,
    meaning: f.symbol_meaning,
    thesis: f.core_thesis,
    philosophy: f.philosophy,
    tagline: f.tagline
  };

  return result;
}

function handleConcept(kb, { concept }) {
  const key = concept.toLowerCase().replace(/\s+/g, '_');
  
  // Direct match
  if (kb.key_concepts[key]) {
    return { concept: key, definition: kb.key_concepts[key] };
  }

  // Fuzzy match
  for (const [k, v] of Object.entries(kb.key_concepts)) {
    if (k.includes(key) || key.includes(k) || v.toLowerCase().includes(concept.toLowerCase())) {
      return { concept: k, definition: v, note: 'Fuzzy match' };
    }
  }

  return { error: `Concept not found: ${concept}`, available: Object.keys(kb.key_concepts) };
}

function handleExamples(kb, { type } = {}) {
  let examples = kb.real_world_examples;
  if (type) {
    examples = examples.filter(e => e.type === type || e.type.includes(type));
  }
  return { count: examples.length, examples };
}

async function handleContent({ content_type, limit = 10 } = {}) {
  try {
    const sql = await getDb();
    let content;
    if (content_type) {
      content = await sql`
        SELECT id, title, slug, content_type, excerpt, published_at 
        FROM content_items WHERE status = 'published' AND content_type = ${content_type}
        ORDER BY published_at DESC NULLS LAST LIMIT ${limit}`;
    } else {
      content = await sql`
        SELECT id, title, slug, content_type, excerpt, published_at 
        FROM content_items WHERE status = 'published'
        ORDER BY published_at DESC NULLS LAST LIMIT ${limit}`;
    }
    return {
      count: content.length,
      articles: content.map(c => ({
        title: c.title,
        type: c.content_type,
        excerpt: c.excerpt,
        url: `${SITE_URL}/content-view?id=${c.slug || c.id}`,
        published: c.published_at
      }))
    };
  } catch (e) {
    return { error: 'Database unavailable', message: e.message };
  }
}

function handleMetrics(kb) {
  // Extract metrics-related info from the framework
  const metrics = {
    description: 'KPIs for tracking the post-labor transition',
    categories: {
      great_decoupling: {
        metrics: ['Labor share of GDP', 'Productivity-wage gap', 'Automation displacement rate', 'Prime-age labor force participation'],
        current_data: {
          'productivity_wage_gap': 'Since 1979: productivity +80%, compensation +29%',
          'prime_age_participation': 'Peaked 97% (1953), now ~89.2% (2025)',
          'manufacturing_employment': 'From 19.5M (1979) to 12.75M (2025), output tripled',
          'ai_code_generation': 'Nearly 50% of code at Google/Microsoft is AI-generated (2025)'
        }
      },
      ownership_breadth: {
        metrics: ['Gini coefficient', 'Top 1% wealth share', 'Homeownership rate', 'Retirement account participation'],
        current_data: {
          'us_gini': '0.434 (2017)',
          'top_1_pct_wealth': '30.8% of net worth (Q1 2025)'
        }
      },
      democratic_resilience: {
        metrics: ['Union membership rate', 'Voter turnout', 'Trust in institutions', 'Corporate lobbying spend'],
        current_data: {
          'union_membership': 'Below 10% in many Western nations',
          'election_spending': '$16 billion in 2020 cycle'
        }
      }
    },
    sources: kb._meta.sources
  };
  return metrics;
}

function handleSubstack(kb) {
  return {
    base_url: kb.substack_index?.base_url,
    tag_url: kb.substack_index?.tag_url,
    article_count: kb.substack_index?.known_articles?.length || 0,
    articles: kb.substack_index?.known_articles || [],
    book: kb.book || null
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  try {
    // GET — return server manifest
    if (req.method === 'GET') {
      return json(200, {
        name: 'ple-knowledge-base',
        version: '2.0.0',
        description: 'Post-Labor Economics Knowledge Base MCP Server. Query PLE frameworks, concepts, real-world examples, and published content.',
        url: `${SITE_URL}/api/mcp`,
        tools: TOOLS,
        instructions: 'POST to /api/mcp with { "tool": "tool_name", "input": { ... } } to execute a tool. GET /api/mcp for this manifest.'
      });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const body = await req.json();
    const { tool, input = {} } = body;

    if (!tool) return json(400, { error: 'tool field is required. Available tools: ' + TOOLS.map(t => t.name).join(', ') });

    const toolDef = TOOLS.find(t => t.name === tool);
    if (!toolDef) return json(400, { error: `Unknown tool: ${tool}`, available: TOOLS.map(t => t.name) });

    const result = await handleTool(tool, input);
    return json(200, { tool, input, result });

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
