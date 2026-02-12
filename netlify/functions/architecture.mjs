import { neon } from '@netlify/neon';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  const method = req.method;
  
  try {
    if (method === 'GET') {
      const id = url.searchParams.get('id');
      const code = url.searchParams.get('code');
      
      if (id) {
        return await getElement(id);
      }
      if (code) {
        return await getElementByCode(code);
      }
      return await listElements(url.searchParams);
    }
    
    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Architecture API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

async function listElements(params) {
  const type = params.get('type');
  const status = params.get('status') || 'active';
  const parentId = params.get('parentId');
  const search = params.get('search');
  
  let query = `
    SELECT ae.*, u.display_name as created_by_name,
           (SELECT COUNT(*) FROM element_relationships WHERE source_id = ae.id) as relationship_count,
           (SELECT COUNT(*) FROM proposals WHERE element_id = ae.id) as proposal_count
    FROM architecture_elements ae
    LEFT JOIN users u ON ae.created_by = u.id
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;
  
  if (type) {
    query += ` AND ae.element_type = $${paramIndex++}`;
    queryParams.push(type);
  }
  
  if (status) {
    query += ` AND ae.status = $${paramIndex++}`;
    queryParams.push(status);
  }
  
  if (parentId) {
    query += ` AND ae.parent_id = $${paramIndex++}`;
    queryParams.push(parentId);
  }
  
  if (search) {
    query += ` AND (ae.title ILIKE $${paramIndex} OR ae.description ILIKE $${paramIndex} OR ae.code ILIKE $${paramIndex})`;
    queryParams.push(`%${search}%`);
    paramIndex++;
  }
  
  query += ` ORDER BY ae.element_type, ae.code`;
  
  const elements = await sql(query, queryParams);
  
  // Group by type for easier frontend consumption
  const grouped = {
    goals: [],
    strategies: [],
    capabilities: [],
    principles: []
  };
  
  elements.forEach(el => {
    const formatted = formatElement(el);
    switch (el.element_type) {
      case 'goal':
        grouped.goals.push(formatted);
        break;
      case 'strategy':
        grouped.strategies.push(formatted);
        break;
      case 'capability':
        grouped.capabilities.push(formatted);
        break;
      case 'principle':
        grouped.principles.push(formatted);
        break;
    }
  });
  
  return jsonResponse({
    elements: elements.map(formatElement),
    grouped,
    total: elements.length
  });
}

async function getElement(id) {
  const elements = await sql(`
    SELECT ae.*, u.display_name as created_by_name
    FROM architecture_elements ae
    LEFT JOIN users u ON ae.created_by = u.id
    WHERE ae.id = $1
  `, [id]);
  
  if (elements.length === 0) {
    return jsonResponse({ error: 'Element not found' }, 404);
  }
  
  // Get relationships
  const relationships = await sql(`
    SELECT er.*, 
           ae.title as target_title, ae.code as target_code, ae.element_type as target_type
    FROM element_relationships er
    JOIN architecture_elements ae ON er.target_id = ae.id
    WHERE er.source_id = $1
    UNION
    SELECT er.*, 
           ae.title as target_title, ae.code as target_code, ae.element_type as target_type
    FROM element_relationships er
    JOIN architecture_elements ae ON er.source_id = ae.id
    WHERE er.target_id = $1
  `, [id]);
  
  // Get related proposals
  const proposals = await sql(`
    SELECT id, title, status, proposal_type, created_at
    FROM proposals
    WHERE element_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [id]);
  
  return jsonResponse({
    element: formatElement(elements[0]),
    relationships: relationships.map(r => ({
      id: r.id,
      type: r.relationship_type,
      target: {
        id: r.target_id,
        title: r.target_title,
        code: r.target_code,
        elementType: r.target_type
      }
    })),
    proposals: proposals.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      type: p.proposal_type,
      createdAt: p.created_at
    }))
  });
}

async function getElementByCode(code) {
  const elements = await sql(`
    SELECT ae.*, u.display_name as created_by_name
    FROM architecture_elements ae
    LEFT JOIN users u ON ae.created_by = u.id
    WHERE ae.code = $1
  `, [code.toUpperCase()]);
  
  if (elements.length === 0) {
    return jsonResponse({ error: 'Element not found' }, 404);
  }
  
  return getElement(elements[0].id);
}

function formatElement(el) {
  return {
    id: el.id,
    type: el.element_type,
    code: el.code,
    title: el.title,
    description: el.description,
    status: el.status,
    parentId: el.parent_id,
    createdBy: el.created_by ? {
      id: el.created_by,
      name: el.created_by_name
    } : null,
    metadata: el.metadata || {},
    relationshipCount: parseInt(el.relationship_count || 0),
    proposalCount: parseInt(el.proposal_count || 0),
    createdAt: el.created_at,
    updatedAt: el.updated_at
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  path: '/api/architecture'
};
