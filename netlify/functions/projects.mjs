/**
 * PLE Platform - Projects API
 * Full project management with lifecycle, linking, and progress tracking
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const projectId = pathParts[2]; // /api/projects/:id

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/projects - List projects
    if (method === 'GET' && !projectId) {
      return await listProjects(db, url, user);
    }

    // GET /api/projects/:id - Get single project
    if (method === 'GET' && projectId) {
      return await getProject(db, projectId, user);
    }

    // POST /api/projects - Create project
    if (method === 'POST' && !projectId) {
      if (!user) return jsonResponse({ error: 'Authentication required' }, 401);
      return await createProject(db, req, user);
    }

    // PUT /api/projects/:id - Update project
    if (method === 'PUT' && projectId) {
      if (!user) return jsonResponse({ error: 'Authentication required' }, 401);
      return await updateProject(db, projectId, req, user);
    }

    // DELETE /api/projects/:id - Archive project
    if (method === 'DELETE' && projectId) {
      if (!user) return jsonResponse({ error: 'Authentication required' }, 401);
      return await archiveProject(db, projectId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Projects API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List projects with filtering
async function listProjects(db, url, user) {
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const owner = url.searchParams.get('owner');
  const visibility = url.searchParams.get('visibility');
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  let query = `
    SELECT p.*, 
           u.display_name as owner_name,
           u.avatar_url as owner_avatar,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks,
           (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) as milestone_count,
           (SELECT COUNT(*) FROM working_groups wg WHERE wg.project_id = p.id) as team_count
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    WHERE 1=1
  `;
  
  const params = [];
  let paramIndex = 1;

  if (status) {
    query += ` AND p.status = $${paramIndex++}`;
    params.push(status);
  }

  if (type) {
    query += ` AND p.project_type = $${paramIndex++}`;
    params.push(type);
  }

  if (owner) {
    query += ` AND p.owner_id = $${paramIndex++}`;
    params.push(owner);
  }

  // Visibility filter - show public always, members if logged in
  if (!user) {
    query += ` AND p.visibility = 'public'`;
  } else if (visibility) {
    query += ` AND p.visibility = $${paramIndex++}`;
    params.push(visibility);
  }

  query += ` ORDER BY 
    CASE p.priority 
      WHEN 'urgent' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'medium' THEN 3 
      WHEN 'low' THEN 4 
    END,
    p.updated_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  params.push(limit, offset);

  const projects = await db.unsafe(query, params);

  // Get total count for pagination
  let countQuery = `SELECT COUNT(*) as total FROM projects p WHERE 1=1`;
  const countParams = [];
  let countIndex = 1;

  if (status) {
    countQuery += ` AND p.status = $${countIndex++}`;
    countParams.push(status);
  }
  if (type) {
    countQuery += ` AND p.project_type = $${countIndex++}`;
    countParams.push(type);
  }
  if (!user) {
    countQuery += ` AND p.visibility = 'public'`;
  }

  const countResult = await db.unsafe(countQuery, countParams);
  const total = parseInt(countResult[0]?.total || 0);

  return jsonResponse({
    projects,
    pagination: { total, limit, offset, hasMore: offset + projects.length < total }
  });
}

// Get single project with full details
async function getProject(db, projectId, user) {
  const projects = await db`
    SELECT p.*, 
           u.display_name as owner_name,
           u.email as owner_email,
           u.avatar_url as owner_avatar,
           prop.title as linked_proposal_title
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    LEFT JOIN proposals prop ON p.linked_proposal_id = prop.id
    WHERE p.id = ${projectId} OR p.slug = ${projectId}
  `;

  if (projects.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  const project = projects[0];

  // Check visibility
  if (project.visibility !== 'public' && !user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  // Get milestones
  const milestones = await db`
    SELECT * FROM milestones 
    WHERE project_id = ${project.id} 
    ORDER BY order_index, target_date
  `;

  // Get tasks summary by status
  const taskStats = await db`
    SELECT status, COUNT(*) as count 
    FROM tasks 
    WHERE project_id = ${project.id}
    GROUP BY status
  `;

  // Get recent tasks
  const recentTasks = await db`
    SELECT t.*, u.display_name as assignee_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.project_id = ${project.id}
    ORDER BY t.updated_at DESC
    LIMIT 10
  `;

  // Get working groups
  const workingGroups = await db`
    SELECT wg.*, 
           u.display_name as lead_name,
           (SELECT COUNT(*) FROM working_group_members wgm WHERE wgm.group_id = wg.id AND wgm.left_at IS NULL) as member_count
    FROM working_groups wg
    LEFT JOIN users u ON wg.lead_id = u.id
    WHERE wg.project_id = ${project.id}
  `;

  // Get linked architecture elements
  let linkedElements = [];
  if (project.linked_elements && project.linked_elements.length > 0) {
    linkedElements = await db`
      SELECT * FROM architecture_elements 
      WHERE code = ANY(${project.linked_elements})
    `;
  }

  // Get recent activity
  const activity = await db`
    SELECT al.*, u.display_name as user_name
    FROM activity_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.entity_type = 'project' AND al.entity_id = ${project.id}
    ORDER BY al.created_at DESC
    LIMIT 20
  `;

  // Get comments
  const comments = await db`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = 'project' AND c.entity_id = ${project.id} AND c.status = 'active'
    ORDER BY c.created_at DESC
  `;

  return jsonResponse({
    ...project,
    milestones,
    taskStats: taskStats.reduce((acc, s) => ({ ...acc, [s.status]: parseInt(s.count) }), {}),
    recentTasks,
    workingGroups,
    linkedElements,
    activity,
    comments
  });
}

// Create new project
async function createProject(db, req, user) {
  const body = await req.json();
  const { 
    title, 
    description, 
    project_type = 'initiative',
    visibility = 'members',
    priority = 'medium',
    linked_proposal_id,
    linked_elements = [],
    start_date,
    target_end_date
  } = body;

  if (!title) {
    return jsonResponse({ error: 'Title is required' }, 400);
  }

  // Generate slug
  const baseSlug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  
  // Check for slug uniqueness
  const existing = await db`SELECT slug FROM projects WHERE slug LIKE ${baseSlug + '%'}`;
  let slug = baseSlug;
  if (existing.length > 0) {
    slug = `${baseSlug}-${existing.length + 1}`;
  }

  const linkedElementsJson = JSON.stringify(linked_elements);

  const result = await db`
    INSERT INTO projects (
      title, slug, description, project_type, status, visibility, priority,
      owner_id, linked_proposal_id, linked_elements, start_date, target_end_date
    ) VALUES (
      ${title}, ${slug}, ${description}, ${project_type}, 'draft', ${visibility}, ${priority},
      ${user.id}, ${linked_proposal_id || null}, ${linkedElementsJson}, 
      ${start_date || null}, ${target_end_date || null}
    )
    RETURNING *
  `;

  const project = result[0];

  // Log activity
  await logActivity(user.id, 'created', 'project', project.id, { title });

  // If linked to a proposal, update proposal status
  if (linked_proposal_id) {
    await db`
      UPDATE proposals 
      SET status = 'implementing', metadata = metadata || '{"project_id": "${project.id}"}'::jsonb
      WHERE id = ${linked_proposal_id}
    `;
    await logActivity(user.id, 'linked_to_project', 'proposal', linked_proposal_id, { project_id: project.id });
  }

  return jsonResponse(project, 201);
}

// Update project
async function updateProject(db, projectId, req, user) {
  const body = await req.json();
  
  // Check ownership or admin
  const existing = await db`SELECT * FROM projects WHERE id = ${projectId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  const project = existing[0];
  if (project.owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  const allowedFields = [
    'title', 'description', 'project_type', 'status', 'visibility', 'priority',
    'linked_elements', 'start_date', 'target_end_date', 'actual_end_date', 'progress'
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400);
  }

  // Build dynamic update query
  const setClause = Object.entries(updates)
    .map(([key, value], i) => {
      if (key === 'linked_elements') {
        return `${key} = $${i + 1}::jsonb`;
      }
      return `${key} = $${i + 1}`;
    })
    .join(', ');

  const values = Object.values(updates).map(v => 
    Array.isArray(v) ? JSON.stringify(v) : v
  );
  values.push(projectId);

  const query = `
    UPDATE projects 
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $${values.length}
    RETURNING *
  `;

  const result = await db.unsafe(query, values);

  // Log activity
  await logActivity(user.id, 'updated', 'project', projectId, { fields: Object.keys(updates) });

  // If status changed to completed, set actual_end_date
  if (updates.status === 'completed' && !updates.actual_end_date) {
    await db`UPDATE projects SET actual_end_date = CURRENT_DATE WHERE id = ${projectId}`;
  }

  return jsonResponse(result[0]);
}

// Archive project (soft delete)
async function archiveProject(db, projectId, user) {
  const existing = await db`SELECT * FROM projects WHERE id = ${projectId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  const project = existing[0];
  if (project.owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  await db`
    UPDATE projects 
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ${projectId}
  `;

  await logActivity(user.id, 'archived', 'project', projectId, { title: project.title });

  return jsonResponse({ success: true, message: 'Project archived' });
}

export const config = {
  path: "/api/projects/*"
};
