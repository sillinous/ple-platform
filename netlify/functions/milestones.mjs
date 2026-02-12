/**
 * PLE Platform - Milestones API
 * Project milestone management for progress tracking
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const milestoneId = pathParts[2]; // /api/milestones/:id

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/milestones - List milestones
    if (method === 'GET' && !milestoneId) {
      return await listMilestones(db, url);
    }

    // GET /api/milestones/:id - Get single milestone
    if (method === 'GET' && milestoneId) {
      return await getMilestone(db, milestoneId);
    }

    // Authenticated routes
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    // POST /api/milestones - Create milestone
    if (method === 'POST' && !milestoneId) {
      return await createMilestone(db, req, user);
    }

    // PUT /api/milestones/:id - Update milestone
    if (method === 'PUT' && milestoneId) {
      return await updateMilestone(db, milestoneId, req, user);
    }

    // DELETE /api/milestones/:id - Delete milestone
    if (method === 'DELETE' && milestoneId) {
      return await deleteMilestone(db, milestoneId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Milestones API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List milestones
async function listMilestones(db, url) {
  const projectId = url.searchParams.get('project_id');
  const status = url.searchParams.get('status');

  let query = `
    SELECT m.*, 
           p.title as project_title,
           p.slug as project_slug,
           (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id) as task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'done') as completed_tasks
    FROM milestones m
    LEFT JOIN projects p ON m.project_id = p.id
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;

  if (projectId) {
    query += ` AND m.project_id = $${paramIndex++}`;
    params.push(projectId);
  }

  if (status) {
    query += ` AND m.status = $${paramIndex++}`;
    params.push(status);
  }

  query += ` ORDER BY m.order_index, m.target_date`;

  const milestones = await db.unsafe(query, params);

  return jsonResponse({ milestones });
}

// Get single milestone
async function getMilestone(db, milestoneId) {
  const milestones = await db`
    SELECT m.*, 
           p.title as project_title,
           p.slug as project_slug
    FROM milestones m
    LEFT JOIN projects p ON m.project_id = p.id
    WHERE m.id = ${milestoneId}
  `;

  if (milestones.length === 0) {
    return jsonResponse({ error: 'Milestone not found' }, 404);
  }

  const milestone = milestones[0];

  // Get tasks
  const tasks = await db`
    SELECT t.*, u.display_name as assignee_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.milestone_id = ${milestoneId}
    ORDER BY t.order_index, t.created_at
  `;

  // Calculate progress
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return jsonResponse({
    ...milestone,
    tasks,
    progress,
    task_count: totalTasks,
    completed_tasks: completedTasks
  });
}

// Create milestone
async function createMilestone(db, req, user) {
  const body = await req.json();
  const {
    project_id,
    title,
    description,
    target_date,
    order_index
  } = body;

  if (!project_id || !title) {
    return jsonResponse({ error: 'Project ID and title are required' }, 400);
  }

  // Verify project exists and user has access
  const project = await db`SELECT * FROM projects WHERE id = ${project_id}`;
  if (project.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  if (project[0].owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  // Get next order index if not specified
  let orderIdx = order_index;
  if (orderIdx === undefined) {
    const maxOrder = await db`
      SELECT COALESCE(MAX(order_index), 0) + 1 as next_order 
      FROM milestones WHERE project_id = ${project_id}
    `;
    orderIdx = maxOrder[0].next_order;
  }

  const result = await db`
    INSERT INTO milestones (project_id, title, description, target_date, order_index, status)
    VALUES (${project_id}, ${title}, ${description || null}, ${target_date || null}, ${orderIdx}, 'upcoming')
    RETURNING *
  `;

  const milestone = result[0];

  await logActivity(user.id, 'created', 'milestone', milestone.id, { title, project_id });

  return jsonResponse(milestone, 201);
}

// Update milestone
async function updateMilestone(db, milestoneId, req, user) {
  const body = await req.json();

  const existing = await db`
    SELECT m.*, p.owner_id as project_owner_id 
    FROM milestones m
    JOIN projects p ON m.project_id = p.id
    WHERE m.id = ${milestoneId}
  `;

  if (existing.length === 0) {
    return jsonResponse({ error: 'Milestone not found' }, 404);
  }

  const milestone = existing[0];

  if (milestone.project_owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  const allowedFields = ['title', 'description', 'target_date', 'completed_date', 'status', 'order_index'];
  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400);
  }

  // Auto-set completed_date when marking complete
  if (updates.status === 'completed' && !updates.completed_date) {
    updates.completed_date = new Date().toISOString().split('T')[0];
  }

  const setClause = Object.keys(updates)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const values = Object.values(updates);
  values.push(milestoneId);

  const query = `
    UPDATE milestones 
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $${values.length}
    RETURNING *
  `;

  const result = await db.unsafe(query, values);

  await logActivity(user.id, 'updated', 'milestone', milestoneId, { fields: Object.keys(updates) });

  return jsonResponse(result[0]);
}

// Delete milestone
async function deleteMilestone(db, milestoneId, user) {
  const existing = await db`
    SELECT m.*, p.owner_id as project_owner_id 
    FROM milestones m
    JOIN projects p ON m.project_id = p.id
    WHERE m.id = ${milestoneId}
  `;

  if (existing.length === 0) {
    return jsonResponse({ error: 'Milestone not found' }, 404);
  }

  const milestone = existing[0];

  if (milestone.project_owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  // Unlink tasks (don't delete them)
  await db`UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ${milestoneId}`;

  // Delete milestone
  await db`DELETE FROM milestones WHERE id = ${milestoneId}`;

  await logActivity(user.id, 'deleted', 'milestone', milestoneId, { title: milestone.title });

  return jsonResponse({ success: true, message: 'Milestone deleted' });
}

export const config = {
  path: "/api/milestones/*"
};
