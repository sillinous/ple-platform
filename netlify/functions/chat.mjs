// PLE AI Chat Assistant — RAG-powered Q&A grounded in Knowledge Base
// POST /api/chat { message, history? }
// GET  /api/chat — capabilities info
import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (req.method === 'GET') {
      return json(200, {
        name: 'PLE AI Assistant',
        description: 'AI-powered Q&A grounded in the Post-Labor Economics knowledge base',
        capabilities: ['PLE framework Q&A', 'Pyramids of Prosperity and Power', 'Automation trends', 'Property interventions', 'Attractor states', 'Real-world examples'],
        model: 'claude-sonnet-4-20250514',
        kb_version: '2.0.0',
        requires_auth: false
      });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const body = await req.json().catch(() => ({}));
    const { message, history = [] } = body;
    if (!message || typeof message !== 'string' || !message.trim()) return json(400, { error: 'Message is required' });
    if (message.length > 2000) return json(400, { error: 'Message too long (max 2000 chars)' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(503, { error: 'AI chat not configured. Set ANTHROPIC_API_KEY env var.', fallback: true });

    // Load KB
    let kb;
    try {
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://postlaboreconomics.netlify.app';
      kb = await (await fetch(`${siteUrl}/data/knowledge-base.json`)).json();
    } catch (e) {
      return json(500, { error: 'Could not load knowledge base' });
    }

    const kbContext = buildContext(kb, message);
    const systemPrompt = buildSystemPrompt(kbContext);
    const messages = [...(history || []).slice(-6).filter(t => t.role === 'user' || t.role === 'assistant'), { role: 'user', content: message }];

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: systemPrompt, messages })
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status);
      return json(502, { error: 'AI service error', fallback: true });
    }

    const aiResponse = await response.json();
    const assistantMessage = aiResponse.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Unable to generate response.';

    // Optional activity log
    try {
      const user = await getCurrentUser(req).catch(() => null);
      if (user) await logActivity(user.id, 'chat_message', 'chat', null, { message_length: message.length }).catch(() => {});
    } catch (e) {}

    return json(200, {
      response: assistantMessage,
      context: { kb_version: kb._meta.version, sections_used: kbContext.sections_used, source_count: kb._meta.sources.length },
      usage: { input_tokens: aiResponse.usage?.input_tokens, output_tokens: aiResponse.usage?.output_tokens }
    });

  } catch (e) {
    console.error('Chat error:', e);
    return json(500, { error: e.message, fallback: true });
  }
}

function buildContext(kb, message) {
  const msg = message.toLowerCase();
  const sections = [];
  const sections_used = ['core'];

  sections.push(`## Core\n${kb.framework.name} (${kb.framework.symbol}): ${kb.framework.core_thesis}\nPhilosophy: ${kb.framework.philosophy}. Tagline: ${kb.framework.tagline}`);

  const matchers = [
    [/prosper|income|ubi|wealth|pyramid.*prosper|layer|universal|fund|wage/, 'pyramid_of_prosperity', () => {
      const pp = kb.framework.pyramid_of_prosperity;
      return `## Pyramid of Prosperity\n${pp.description}\n` + pp.layers.map(l => `Layer ${l.layer}: ${l.name} — ${l.description}. Examples: ${l.examples.join(', ')}`).join('\n');
    }],
    [/power|democra|govern|civic|right|transparen|vote|fork|bedrock/, 'pyramid_of_power', () => {
      const pp = kb.framework.pyramid_of_power;
      return `## Pyramid of Power\n${pp.description}\n` + pp.layers.map(l => `Layer ${l.layer}: ${l.name} — ${l.description}`).join('\n');
    }],
    [/automat|history|rise|revolution|industrial|machine|robot|displace|job|labor.*substit/, 'six_part_series', () => {
      return `## Six-Part Framework\n` + kb.framework.six_part_series.map(s => `Part ${s.part}: ${s.title} — ${s.summary}`).join('\n');
    }],
    [/four.*offer|strength|dexterity|cognit|empathy|human.*offer|replac/, 'four_human_offerings', () => {
      const f = kb.framework.four_human_offerings;
      if (!f) return null;
      return `## Four Human Offerings\n${f.description}\n` + f.offerings.map(o => `${o.name}: ${o.description} Status: ${o.automation_status}`).join('\n') + `\nKey: ${f.key_insight}`;
    }],
    [/technofeud|attractor|trajectory|default|abundance|normalcy|evolv|moloch/, 'attractor_states', () => {
      const a = kb.framework.attractor_states;
      if (!a) return null;
      return `## Attractor States\n${a.description}\n` + a.states.map(s => `${s.name} (${s.type}): ${s.description}`).join('\n');
    }],
    [/property|intervention|dividend|royalt|co-?op|esop|bank|credit union|token|cef|swf|16/, 'property_interventions', () => {
      const p = kb.framework.property_interventions;
      if (!p) return null;
      return `## 16 Property Interventions\n${p.description}\nBanking thesis: ${p.banking_thesis}\n` + p.interventions.map(i => `${i.id}. ${i.name}: ${i.description}`).join('\n');
    }],
    [/agenc|principl|time.*sovereign|financial.*author|knowledge.*access|communit.*power/, 'economic_agency_principles', () => {
      return `## Economic Agency Principles\n` + kb.framework.economic_agency_principles.map(p => `${p.name}: ${p.description}`).join('\n');
    }],
    [/manifesto|tenet|core.*belief/, 'manifesto_principles', () => {
      return `## Manifesto Principles\n` + kb.framework.manifesto_principles.map(p => `${p.principle}: ${p.description}`).join('\n');
    }],
    [/concept|labor.*zero|decoupl|solarpunk|structured.*optim/, 'key_concepts', () => {
      return `## Key Concepts\n` + Object.entries(kb.key_concepts).map(([k, v]) => `${k}: ${v.definition}`).join('\n');
    }],
    [/example|alaska|mondragon|nordic|finland|singapore|real.*world|proof/, 'real_world_examples', () => {
      return `## Real-World Examples\n` + kb.real_world_examples.map(e => `${e.name}: ${e.description}`).join('\n');
    }],
    [/data|statistic|number|metric|decline|union|percent/, 'labor_decline_data', () => {
      const d = kb.framework.labor_decline_data;
      if (!d) return null;
      return `## Labor Decline Data\n` + d.statistics.map(s => `${s.metric}: ${s.value} (${s.source})`).join('\n');
    }]
  ];

  for (const [regex, name, builder] of matchers) {
    if (regex.test(msg)) {
      const text = builder();
      if (text) { sections.push(text); sections_used.push(name); }
    }
  }

  // If only core matched, add overview
  if (sections_used.length <= 1) {
    sections.push(`## Overview\nPLE covers: Rise of Automation, Decline of Labor, Power & Prosperity pyramids, Concrete Policy, Life After Labor.\nConcepts: ${Object.keys(kb.key_concepts).join(', ')}\nExamples: ${kb.real_world_examples.map(e => e.name).join(', ')}\n16 property interventions for post-labor income. Three attractor states: Technofeudalism, Normalcy Bias, Techno-Abundance.`);
    sections_used.push('overview');
  }

  return { text: sections.join('\n\n'), sections_used };
}

function buildSystemPrompt(ctx) {
  return `You are the PLE AI Assistant — an expert on Post-Labor Economics (PLE), David Shapiro's framework for navigating a world where automation makes human labor increasingly unnecessary.

KNOWLEDGE BASE:
${ctx.text}

GUIDELINES:
- Conversational but substantive. Explain jargon.
- Name specific framework elements (pyramids, principles, concepts) when relevant.
- Use data and examples from the knowledge base.
- Maintain "Structured Optimism" — honest about challenges, clear about paths forward.
- Keep responses 150-300 words unless depth is needed.
- Credit David Shapiro's work appropriately.
- Use markdown for readability when helpful.
- If unsure, say so. Don't fabricate.
- The PLE symbol is L/0 — the threshold from Labor to Zero (post-labor).`;
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

export const config = { path: '/api/chat' };
