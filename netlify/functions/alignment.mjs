// Architecture Alignment API — Links platform items to architecture elements
// GET  /api/alignment?element=<id|code>  — Get all items aligned to an element
// GET  /api/alignment?item=<id>&type=<content|proposal|discussion|project> — Get element for item
// GET  /api/alignment/summary — Overview of all alignments
// POST /api/alignment — Link an item to an element (admin/editor)
// DELETE /api/alignment — Unlink an item from an element (admin/editor)

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() });
  }

  const url = new URL(req.url, 'http://localhost');
  const db = getDb();

  // GET — query alignments
  if (req.method === 'GET') {
    const elementParam = url.searchParams.get('element');
    const itemId = url.searchParams.get('item');
    const itemType = url.searchParams.get('type');
    const summary = url.pathname.endsWith('/summary');

    // Summary view: all elements with their linked item counts
    if (summary) {
      const elements = await db`
        SELECT ae.id, ae.code, ae.title, ae.element_type, ae.description,
          (SELECT COUNT(*) FROM proposals p WHERE p.element_id = ae.id) as proposal_count,
          (SELECT COUNT(*) FROM content_items ci WHERE ci.element_id = ae.id) as content_count,
          (SELECT COUNT(*) FROM discussions d WHERE d.element_id = ae.id) as discussion_count,
          (SELECT COUNT(*) FROM projects pr WHERE pr.linked_elements::jsonb @> to_jsonb(ae.id::text)) as project_count
        FROM architecture_elements ae
        ORDER BY ae.element_type, ae.code
      `.catch(() => []);

      // Fallback: simpler query without jsonb project check
      let result = elements;
      if (elements.length === 0) {
        result = await db`
          SELECT ae.id, ae.code, ae.title, ae.element_type, ae.description,
            (SELECT COUNT(*) FROM proposals p WHERE p.element_id = ae.id) as proposal_count,
            (SELECT COUNT(*) FROM content_items ci WHERE ci.element_id = ae.id) as content_count,
            (SELECT COUNT(*) FROM discussions d WHERE d.element_id = ae.id) as discussion_count,
            0 as project_count
          FROM architecture_elements ae
          ORDER BY ae.element_type, ae.code
        `.catch(() => []);
      }

      const total_alignments = result.reduce((sum, e) => 
        sum + (parseInt(e.proposal_count) || 0) + (parseInt(e.content_count) || 0) + 
        (parseInt(e.discussion_count) || 0) + (parseInt(e.project_count) || 0), 0);

      return json(200, {
        element_count: result.length,
        total_alignments,
        elements: result.map(e => ({
          id: e.id,
          code: e.code,
          title: e.title,
          type: e.element_type,
          alignments: {
            proposals: parseInt(e.proposal_count) || 0,
            content: parseInt(e.content_count) || 0,
            discussions: parseInt(e.discussion_count) || 0,
            projects: parseInt(e.project_count) || 0,
            total: (parseInt(e.proposal_count) || 0) + (parseInt(e.content_count) || 0) +
                   (parseInt(e.discussion_count) || 0) + (parseInt(e.project_count) || 0)
          }
        }))
      });
    }

    // Get items aligned to a specific element
    if (elementParam) {
      // Find element by ID or code
      const element = await db`
        SELECT * FROM architecture_elements 
        WHERE id::text = ${elementParam} OR code = ${elementParam.toUpperCase()}
        LIMIT 1
      `;
      if (element.length === 0) return json(404, { error: 'Element not found' });

      const el = element[0];

      const [proposals, content, discussions] = await Promise.all([
        db`SELECT id, title, proposal_type, status, created_at FROM proposals WHERE element_id = ${el.id} ORDER BY created_at DESC`,
        db`SELECT id, title, content_type, status, slug, published_at FROM content_items WHERE element_id = ${el.id} ORDER BY published_at DESC NULLS LAST`,
        db`SELECT id, title, discussion_type, status, created_at FROM discussions WHERE element_id = ${el.id} ORDER BY created_at DESC`
      ]);

      // Projects with this element in linked_elements
      let projects = [];
      try {
        projects = await db`
          SELECT id, title, status, project_type FROM projects 
          WHERE linked_elements::jsonb @> to_jsonb(${el.id}::text)
          ORDER BY created_at DESC
        `;
      } catch (e) {
        // linked_elements might not be jsonb in all cases
      }

      return json(200, {
        element: {
          id: el.id,
          code: el.code,
          title: el.title,
          type: el.element_type,
          description: el.description
        },
        alignments: {
          proposals: proposals.map(p => ({ id: p.id, title: p.title, type: p.proposal_type, status: p.status })),
          content: content.map(c => ({ id: c.id, title: c.title, type: c.content_type, status: c.status, slug: c.slug })),
          discussions: discussions.map(d => ({ id: d.id, title: d.title, type: d.discussion_type, status: d.status })),
          projects: projects.map(p => ({ id: p.id, title: p.title, type: p.project_type, status: p.status }))
        },
        total: proposals.length + content.length + discussions.length + projects.length
      });
    }

    // Get alignment for a specific item
    if (itemId && itemType) {
      let elementId = null;
      if (itemType === 'proposal') {
        const r = await db`SELECT element_id FROM proposals WHERE id = ${itemId}`;
        elementId = r[0]?.element_id;
      } else if (itemType === 'content') {
        const r = await db`SELECT element_id FROM content_items WHERE id = ${itemId}`;
        elementId = r[0]?.element_id;
      } else if (itemType === 'discussion') {
        const r = await db`SELECT element_id FROM discussions WHERE id = ${itemId}`;
        elementId = r[0]?.element_id;
      }

      if (!elementId) return json(200, { item_id: itemId, type: itemType, element: null });

      const el = await db`SELECT id, code, title, element_type, description FROM architecture_elements WHERE id = ${elementId}`;
      return json(200, { item_id: itemId, type: itemType, element: el[0] || null });
    }

    return json(400, { error: 'Provide ?element=<id|code>, ?item=<id>&type=<type>, or /summary' });
  }

  // POST — create alignment (link item to element)
  if (req.method === 'POST') {
    const user = await getCurrentUser(req, db);
    if (!user || !['admin', 'editor'].includes(user.role)) {
      return json(403, { error: 'Admin or editor required' });
    }

    const body = await req.json();
    const { item_id, item_type, element_id, element_code } = body;

    if (!item_id || !item_type) return json(400, { error: 'item_id and item_type required' });
    if (!element_id && !element_code) return json(400, { error: 'element_id or element_code required' });

    // Resolve element
    let el;
    if (element_id) {
      el = await db`SELECT id, code, title FROM architecture_elements WHERE id::text = ${element_id}`;
    } else {
      el = await db`SELECT id, code, title FROM architecture_elements WHERE code = ${element_code.toUpperCase()}`;
    }
    if (el.length === 0) return json(404, { error: 'Element not found' });

    const elId = el[0].id;

    // Update the appropriate table
    if (item_type === 'proposal') {
      await db`UPDATE proposals SET element_id = ${elId} WHERE id = ${item_id}`;
    } else if (item_type === 'content') {
      await db`UPDATE content_items SET element_id = ${elId} WHERE id = ${item_id}`;
    } else if (item_type === 'discussion') {
      await db`UPDATE discussions SET element_id = ${elId} WHERE id = ${item_id}`;
    } else if (item_type === 'project') {
      // For projects, add to linked_elements array
      await db`
        UPDATE projects 
        SET linked_elements = COALESCE(linked_elements, '[]'::jsonb) || to_jsonb(${elId}::text)
        WHERE id = ${item_id}
      `.catch(async () => {
        // Fallback: treat as text array
        await db`UPDATE projects SET linked_elements = linked_elements || ${JSON.stringify([elId])}::jsonb WHERE id = ${item_id}`;
      });
    } else {
      return json(400, { error: 'item_type must be: proposal, content, discussion, or project' });
    }

    await logActivity(user.id, 'alignment_created', item_type, item_id, { element: el[0].code });

    return json(200, {
      aligned: true,
      item: { id: item_id, type: item_type },
      element: { id: elId, code: el[0].code, title: el[0].title }
    });
  }

  // DELETE — remove alignment
  if (req.method === 'DELETE') {
    const user = await getCurrentUser(req, db);
    if (!user || !['admin', 'editor'].includes(user.role)) {
      return json(403, { error: 'Admin or editor required' });
    }

    const body = await req.json();
    const { item_id, item_type } = body;

    if (!item_id || !item_type) return json(400, { error: 'item_id and item_type required' });

    if (item_type === 'proposal') {
      await db`UPDATE proposals SET element_id = NULL WHERE id = ${item_id}`;
    } else if (item_type === 'content') {
      await db`UPDATE content_items SET element_id = NULL WHERE id = ${item_id}`;
    } else if (item_type === 'discussion') {
      await db`UPDATE discussions SET element_id = NULL WHERE id = ${item_id}`;
    } else {
      return json(400, { error: 'item_type must be: proposal, content, or discussion' });
    }

    await logActivity(user.id, 'alignment_removed', item_type, item_id, {});

    return json(200, { unlinked: true, item: { id: item_id, type: item_type } });
  }

  return json(405, { error: 'Method not allowed' });
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...cors() }
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

export const config = { path: ['/api/alignment', '/api/alignment/summary'] };
