// AI Chat — RAG-powered assistant grounded in PLE knowledge base + platform content
// Uses Anthropic API via the artifact proxy (no API key needed in claude.ai context)
// Falls back to knowledge-base-only mode if API unavailable
//
// POST /api/chat — { message, history? }
// GET  /api/chat?action=context — returns the system prompt / KB summary used for RAG

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

const SITE_URL = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';

// Build RAG context from knowledge base + relevant content
async function buildContext(query) {
  let kb;
  try {
    const r = await fetch(`${SITE_URL}/data/knowledge-base.json`);
    kb = await r.json();
  } catch (e) {
    kb = null;
  }

  // Fetch recent/relevant content from DB
  let dbContent = [];
  try {
    const sql = await getDb();
    // Simple keyword matching — find content related to the query
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    if (words.length > 0) {
      const pattern = words.join('|');
      dbContent = await sql`
        SELECT title, excerpt, body, content_type, slug 
        FROM content_items 
        WHERE status = 'published' 
          AND (title ~* ${pattern} OR excerpt ~* ${pattern} OR body ~* ${pattern})
        LIMIT 5
      `;
    }
    if (dbContent.length === 0) {
      dbContent = await sql`
        SELECT title, excerpt, content_type, slug 
        FROM content_items 
        WHERE status = 'published' 
        ORDER BY published_at DESC NULLS LAST 
        LIMIT 5
      `;
    }
  } catch (e) {
    // DB unavailable — use KB only
  }

  // Compose the context document
  let context = '';

  if (kb) {
    context += `# Post-Labor Economics Knowledge Base (v${kb._meta.version})\n\n`;
    context += `## Core Framework\n`;
    context += `**Name:** ${kb.framework.name}\n`;
    context += `**Symbol:** ${kb.framework.symbol} (${kb.framework.symbol_meaning})\n`;
    context += `**Core Thesis:** ${kb.framework.core_thesis}\n`;
    context += `**Philosophy:** ${kb.framework.philosophy}\n\n`;

    context += `## Six-Part Series\n`;
    for (const part of kb.framework.six_part_series) {
      context += `**Part ${part.part}: ${part.title}** — ${part.summary}\nKey insight: ${part.key_insight}\n\n`;
    }

    context += `## Pyramid of Prosperity\n${kb.framework.pyramid_of_prosperity.description}\n`;
    for (const layer of kb.framework.pyramid_of_prosperity.layers) {
      context += `- **Layer ${layer.level}: ${layer.name}** — ${layer.description} (Examples: ${layer.examples.join(', ')})\n`;
    }

    context += `\n## Pyramid of Power\n${kb.framework.pyramid_of_power.description}\n`;
    for (const layer of kb.framework.pyramid_of_power.layers) {
      context += `- **Layer ${layer.level}: ${layer.name}** — ${layer.description}\n`;
    }

    context += `\n## Key Concepts\n`;
    for (const [key, val] of Object.entries(kb.key_concepts)) {
      context += `- **${key.replace(/_/g, ' ')}:** ${val}\n`;
    }

    context += `\n## Economic Agency Principles\n`;
    for (const p of kb.framework.economic_agency_principles) {
      context += `- **${p.name}:** ${p.description}\n`;
    }

    context += `\n## Real-World Examples\n`;
    for (const ex of kb.real_world_examples) {
      context += `- **${ex.name}** (${ex.type}): ${ex.description}\n`;
    }

    context += `\n## Historical Context\n`;
    for (const h of kb.historical_context) {
      context += `- **${h.era}:** ${h.description}\n`;
    }

    if (kb.book) {
      context += `\n## Upcoming Book\n**${kb.book.title}** by ${kb.book.author} — ${kb.book.status}, expected ${kb.book.expected}. ${kb.book.description}\n`;
    }
  }

  if (dbContent.length > 0) {
    context += `\n## Platform Content (Recent/Relevant)\n`;
    for (const c of dbContent) {
      context += `### ${c.title} [${c.content_type}]\n`;
      if (c.excerpt) context += `${c.excerpt}\n`;
      if (c.body) context += `${c.body.substring(0, 800)}...\n`;
      context += `\n`;
    }
  }

  return { context, kb, dbContent };
}

const SYSTEM_PROMPT = `You are the PLE Assistant — an AI guide for the Post-Labor Economics platform founded by David Shapiro.

Your role:
- Answer questions about Post-Labor Economics grounded in the knowledge base
- Explain the Pyramid of Prosperity, Pyramid of Power, and related frameworks
- Connect user questions to specific concepts, real-world examples, and platform content
- Be warm, intellectually rigorous, and optimistic (Structured Optimism)
- Cite specific framework elements, layers, or examples when relevant
- If you don't know something or it's outside the KB, say so honestly

Tone: Approachable but substantive. Like a well-read colleague who genuinely cares about the topic.

IMPORTANT: Ground your answers in the provided context. Don't make up framework details. If the user asks about something not covered, acknowledge the gap and suggest where they might find answers.`;

export default async function handler(req) {
  const url = new URL(req.url, 'http://localhost');

  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  try {
    // GET — return context info
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'context') {
        const { context, kb } = await buildContext('overview');
        return json(200, {
          system_prompt_length: SYSTEM_PROMPT.length,
          context_length: context.length,
          kb_version: kb?._meta?.version,
          kb_articles: kb?.seed_content?.length,
          has_kb: !!kb
        });
      }
      return json(200, {
        service: 'PLE AI Chat',
        description: 'RAG-powered assistant grounded in PLE knowledge base',
        usage: 'POST /api/chat with { "message": "your question" }',
        context_check: 'GET /api/chat?action=context'
      });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const body = await req.json();
    const { message, history = [] } = body;

    if (!message) return json(400, { error: 'Message is required' });

    // Build RAG context
    const { context } = await buildContext(message);

    // Try Anthropic API (works in claude.ai artifact context)
    let aiResponse;
    try {
      const messages = [];

      // Add history (last 6 turns max)
      const recentHistory = history.slice(-6);
      for (const h of recentHistory) {
        messages.push({ role: h.role, content: h.content });
      }

      // Add current message with context
      messages.push({
        role: 'user',
        content: `Context from PLE Knowledge Base:\n\n${context}\n\n---\n\nUser question: ${message}`
      });

      const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages
        })
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        aiResponse = data.content?.map(c => c.text || '').join('\n') || '';
      }
    } catch (e) {
      // API not available — fall back to KB-only response
    }

    // Fallback: generate a KB-grounded response without AI
    if (!aiResponse) {
      aiResponse = generateKBResponse(message, context);
    }

    // Log the interaction (optional)
    try {
      const user = await getCurrentUser(req);
      if (user) {
        const sql = await getDb();
        await logActivity(user.id, 'ai_chat', 'chat', null, {
          query: message.substring(0, 200),
          response_length: aiResponse.length,
          method: aiResponse.startsWith('[KB]') ? 'knowledge_base' : 'ai_api'
        });
      }
    } catch (e) { /* logging is optional */ }

    return json(200, {
      response: aiResponse,
      sources: {
        kb_version: '2.0.0',
        grounded: true
      }
    });

  } catch (e) {
    return json(500, { error: e.message });
  }
}

// Fallback KB-only response generator
function generateKBResponse(query, context) {
  const q = query.toLowerCase();

  // Match against known topics
  const topics = [
    { keywords: ['pyramid', 'prosperity', 'income', 'ubi', 'universal'], section: 'Pyramid of Prosperity' },
    { keywords: ['pyramid', 'power', 'democracy', 'governance', 'civic'], section: 'Pyramid of Power' },
    { keywords: ['automation', 'rise', 'history', 'manufacturing', 'industrial'], section: 'Rise of Automation' },
    { keywords: ['decline', 'labor', 'jobs', 'displacement', 'wages'], section: 'Decline of Labor' },
    { keywords: ['social contract', 'contract', 'fraying', 'leverage'], section: 'Power and Social Contracts' },
    { keywords: ['metric', 'kpi', 'measure', 'data', 'dashboard'], section: 'Measurements and KPI' },
    { keywords: ['life after', 'flourishing', 'purpose', 'burnout', 'community'], section: 'Life After Labor' },
    { keywords: ['what is', 'introduction', 'explain', 'overview', 'basics'], section: 'Introduction' },
    { keywords: ['example', 'alaska', 'mondragon', 'nordic', 'finland', 'real world'], section: 'Real-World Examples' },
    { keywords: ['16', 'sixteen', 'income stream', 'property', 'banking', 'dividend'], section: '16 Income Streams' },
    { keywords: ['manifesto', 'principle', 'neoliberal', 'subsidiarity'], section: 'Manifesto' },
    { keywords: ['book', 'great decoupling', 'shapiro'], section: 'About' },
  ];

  let bestMatch = null;
  let bestScore = 0;
  for (const topic of topics) {
    const score = topic.keywords.filter(k => q.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = topic;
    }
  }

  // Extract relevant section from context
  if (bestMatch && bestScore > 0) {
    const lines = context.split('\n');
    const sectionStart = lines.findIndex(l => l.toLowerCase().includes(bestMatch.section.toLowerCase()));
    if (sectionStart >= 0) {
      const sectionContent = lines.slice(sectionStart, sectionStart + 20).join('\n');
      return `[KB] Based on the PLE Knowledge Base:\n\n${sectionContent}\n\n*Ask me to go deeper on any specific concept, layer, or example.*`;
    }
  }

  // Generic response
  return `[KB] Post-Labor Economics (PLE) is a framework for navigating the transition from labor-based economics to a post-labor society. It was developed by David Shapiro and encompasses:\n\n• **The Pyramid of Prosperity** — 5 layers of income replacement (from Universal Basic Income to residual wages)\n• **The Pyramid of Power** — 5 layers of democratic resilience (from immutable rights to forkable governance)\n• **A Six-Part Series** covering automation history, labor decline, social contracts, metrics, interventions, and life after labor\n\nThe core thesis: AI, automation, and robotics will make human labor optional. The question isn't whether this happens, but whether we build systems that ensure everyone benefits.\n\nWhat specific aspect would you like to explore?`;
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export const config = { path: '/api/chat' };
