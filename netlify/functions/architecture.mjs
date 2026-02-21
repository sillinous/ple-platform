import { getDb, jsonResponse } from './lib/db.mjs';

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    if (req.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    
    const sql = await getDb();
    const id = url.searchParams.get('id');
    const code = url.searchParams.get('code');
    
    if (id) return await getElement(sql, id);
    if (code) return await getElementByCode(sql, code);
    return await listElements(sql, url.searchParams);
  } catch (error) {
    console.error('Architecture API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

async function listElements(sql, params) {
  const type = params.get('type') || null;
  const status = params.get('status') || 'active';
  const search = params.get('search') || null;
  const searchPattern = search ? `%${search}%` : null;
  
  const elements = await sql`
    SELECT ae.*, u.display_name as created_by_name,
           (SELECT COUNT(*) FROM element_relationships WHERE source_id = ae.id OR target_id = ae.id) as relationship_count,
           (SELECT COUNT(*) FROM proposals WHERE element_id = ae.id) as proposal_count,
           (SELECT COUNT(*) FROM content_items WHERE element_id = ae.id) as content_count,
           (SELECT COUNT(*) FROM discussions WHERE element_id = ae.id) as discussion_count
    FROM architecture_elements ae
    LEFT JOIN users u ON ae.created_by = u.id
    WHERE (${type}::text IS NULL OR ae.element_type = ${type})
      AND ae.status = ${status}
      AND (${searchPattern}::text IS NULL OR ae.title ILIKE ${searchPattern} OR ae.description ILIKE ${searchPattern} OR ae.code ILIKE ${searchPattern})
    ORDER BY ae.element_type, ae.code
  `;
  
  const grouped = { goals: [], strategies: [], capabilities: [], principles: [] };
  elements.forEach(el => {
    const formatted = formatElement(el);
    if (el.element_type === 'goal') grouped.goals.push(formatted);
    else if (el.element_type === 'strategy') grouped.strategies.push(formatted);
    else if (el.element_type === 'capability') grouped.capabilities.push(formatted);
    else if (el.element_type === 'principle') grouped.principles.push(formatted);
  });
  
  return jsonResponse({ elements: elements.map(formatElement), grouped, total: elements.length });
}

async function getElement(sql, id) {
  const elements = await sql`
    SELECT ae.*, u.display_name as created_by_name
    FROM architecture_elements ae LEFT JOIN users u ON ae.created_by = u.id
    WHERE ae.id = ${id}
  `;
  
  if (elements.length === 0) return jsonResponse({ error: 'Element not found' }, 404);
  
  const relationships = await sql`
    SELECT er.*, ae.title as target_title, ae.code as target_code, ae.element_type as target_type
    FROM element_relationships er
    JOIN architecture_elements ae ON er.target_id = ae.id
    WHERE er.source_id = ${id}
    UNION
    SELECT er.*, ae.title as target_title, ae.code as target_code, ae.element_type as target_type
    FROM element_relationships er
    JOIN architecture_elements ae ON er.source_id = ae.id
    WHERE er.target_id = ${id}
  `;
  
  const proposals = await sql`
    SELECT id, title, status, proposal_type, created_at
    FROM proposals WHERE element_id = ${id} ORDER BY created_at DESC LIMIT 10
  `;

  const content = await sql`
    SELECT id, title, slug, content_type, status, published_at
    FROM content_items WHERE element_id = ${id} ORDER BY published_at DESC NULLS LAST LIMIT 10
  `;

  const discussions = await sql`
    SELECT id, title, discussion_type, status, created_at
    FROM discussions WHERE element_id = ${id} ORDER BY created_at DESC LIMIT 10
  `;
  
  const el = formatElement(elements[0]);

  return jsonResponse({
    element: el,
    relationships: relationships.map(r => ({
      id: r.id, type: r.relationship_type,
      target: { id: r.target_id, title: r.target_title, code: r.target_code, elementType: r.target_type }
    })),
    alignments: {
      proposals: proposals.map(p => ({
        id: p.id, title: p.title, status: p.status, type: p.proposal_type, createdAt: p.created_at
      })),
      content: content.map(c => ({
        id: c.id, title: c.title, slug: c.slug, type: c.content_type, status: c.status
      })),
      discussions: discussions.map(d => ({
        id: d.id, title: d.title, type: d.discussion_type, status: d.status
      }))
    },
    kb_section: el.metadata?.kb_section || null
  });
}

async function getElementByCode(sql, code) {
  const codeUpper = code.toUpperCase();
  const elements = await sql`SELECT id FROM architecture_elements WHERE code = ${codeUpper}`;
  if (elements.length === 0) return jsonResponse({ error: 'Element not found' }, 404);
  return getElement(sql, elements[0].id);
}

function formatElement(el) {
  return {
    id: el.id, type: el.element_type, code: el.code, title: el.title,
    description: el.description, status: el.status, parentId: el.parent_id,
    createdBy: el.created_by ? { id: el.created_by, name: el.created_by_name } : null,
    metadata: el.metadata || {},
    relationshipCount: parseInt(el.relationship_count || 0),
    proposalCount: parseInt(el.proposal_count || 0),
    contentCount: parseInt(el.content_count || 0),
    discussionCount: parseInt(el.discussion_count || 0),
    createdAt: el.created_at, updatedAt: el.updated_at
  };
}

export const config = { path: '/api/architecture' };
