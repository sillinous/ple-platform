/**
 * PLE Platform - Tasks API
 * Task management with Kanban workflow, assignments, and subtasks
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const taskId = pathParts[2]; // /api/tasks/:id
  const action = pathParts[3]; // /api/tasks/:id/move, /api/tasks/:id/assign

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/tasks - List tasks
    if (method === 'GET' && !taskId) {
      return await listTasks(db, url, user);
    }

    // GET /api/tasks/:id - Get single task
    if (method === 'GET' && taskId && !action) {
      return await getTask(db, taskId, user);
    }

    // Authenticated routes
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    // POST /api/tasks - Create task
    if (method === 'POST' && !taskId) {
      return await createTask(db, req, user);
    }

    // PUT /api/tasks/:id - Update task
    if (method === 'PUT' && taskId && !action) {
      return await updateTask(db, taskId, req, user);
    }

    // POST /api/tasks/:id/move - Move task (Kanban)
    if (method === 'POST' && taskId && action === 'move') {
      return await moveTask(db, taskId, req, user);
    }

    // POST /api/tasks/:id/assign - Assign task
    if (method === 'POST' && taskId && action === 'assign') {
      return await assignTask(db, taskId, req, user);
    }

    // DELETE /api/tasks/:id - Delete task
    if (method === 'DELETE' && taskId) {
      return await deleteTask(db, taskId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Tasks API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List tasks with filtering
async function listTasks(db, url, user) {
  const projectId = url.searchParams.get('project_id');
  const milestoneId = url.searchParams.get('milestone_id');
  const status = url.searchParams.get('status');
  const assignee = url.searchParams.get('assigned_to');
  const priority = url.searchParams.get('priority');
  const view = url.searchParams.get('view') || 'list'; // list, kanban, my-tasks
  const limit = parseInt(url.searchParams.get('limit')) || 100;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  let query = `
    SELECT t.*, 
           p.title as project_title,
           p.slug as project_slug,
           u.display_name as assignee_name,
           u.avatar_url as assignee_avatar,
           creator.display_name as creator_name,
           m.title as milestone_title,
           (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) as subtask_count,
           (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id AND st.status = 'done') as completed_subtasks
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN milestones m ON t.milestone_id = m.id
    WHERE t.parent_task_id IS NULL
  `;

  const params = [];
  let paramIndex = 1;

  if (projectId) {
    query += ` AND t.project_id = $${paramIndex++}`;
    params.push(projectId);
  }

  if (milestoneId) {
    query += ` AND t.milestone_id = $${paramIndex++}`;
    params.push(milestoneId);
  }

  if (status) {
    if (status.includes(',')) {
      const statuses = status.split(',');
      query += ` AND t.status = ANY($${paramIndex++})`;
      params.push(statuses);
    } else {
      query += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }
  }

  if (assignee) {
    if (assignee === 'me' && user) {
      query += ` AND t.assigned_to = $${paramIndex++}`;
      params.push(user.id);
    } else if (assignee === 'unassigned') {
      query += ` AND t.assigned_to IS NULL`;
    } else {
      query += ` AND t.assigned_to = $${paramIndex++}`;
      params.push(assignee);
    }
  }

  if (priority) {
    query += ` AND t.priority = $${paramIndex++}`;
    params.push(priority);
  }

  // View-specific sorting
  if (view === 'kanban') {
    query += ` ORDER BY t.order_index, t.priority DESC, t.created_at`;
  } else if (view === 'my-tasks') {
    query += ` ORDER BY 
      CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.due_date NULLS LAST,
      t.created_at DESC`;
  } else {
    query += ` ORDER BY t.order_index, t.created_at DESC`;
  }

  query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const tasks = await db.unsafe(query, params);

  // For Kanban view, group by status
  if (view === 'kanban') {
    const columns = {
      backlog: tasks.filter(t => t.status === 'backlog'),
      todo: tasks.filter(t => t.status === 'todo'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      review: tasks.filter(t => t.status === 'review'),
      done: tasks.filter(t => t.status === 'done'),
      blocked: tasks.filter(t => t.status === 'blocked')
    };
    return jsonResponse({ view: 'kanban', columns });
  }

  return jsonResponse({ tasks, view });
}

// Get single task with full details
async function getTask(db, taskId, user) {
  const tasks = await db`
    SELECT t.*, 
           p.title as project_title,
           p.slug as project_slug,
           u.display_name as assignee_name,
           u.email as assignee_email,
           u.avatar_url as assignee_avatar,
           creator.display_name as creator_name,
           m.title as milestone_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = ${taskId}
  `;

  if (tasks.length === 0) {
    return jsonResponse({ error: 'Task not found' }, 404);
  }

  const task = tasks[0];

  // Get subtasks
  const subtasks = await db`
    SELECT t.*, u.display_name as assignee_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.parent_task_id = ${taskId}
    ORDER BY t.order_index, t.created_at
  `;

  // Get comments
  const comments = await db`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = 'task' AND c.entity_id = ${taskId} AND c.status = 'active'
    ORDER BY c.created_at
  `;

  // Get activity
  const activity = await db`
    SELECT al.*, u.display_name as user_name
    FROM activity_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.entity_type = 'task' AND al.entity_id = ${taskId}
    ORDER BY al.created_at DESC
    LIMIT 20
  `;

  return jsonResponse({
    ...task,
    subtasks,
    comments,
    activity
  });
}

// Create task
async function createTask(db, req, user) {
  const body = await req.json();
  const {
    project_id,
    milestone_id,
    title,
    description,
    status = 'backlog',
    priority = 'medium',
    assigned_to,
    parent_task_id,
    due_date,
    estimated_hours
  } = body;

  if (!project_id || !title) {
    return jsonResponse({ error: 'Project ID and title are required' }, 400);
  }

  // Verify project exists
  const project = await db`SELECT id FROM projects WHERE id = ${project_id}`;
  if (project.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  // Get max order_index for positioning
  const maxOrder = await db`
    SELECT COALESCE(MAX(order_index), 0) + 1 as next_order 
    FROM tasks 
    WHERE project_id = ${project_id} AND status = ${status}
  `;

  const result = await db`
    INSERT INTO tasks (
      project_id, milestone_id, title, description, status, priority,
      assigned_to, parent_task_id, due_date, estimated_hours,
      order_index, created_by
    ) VALUES (
      ${project_id}, ${milestone_id || null}, ${title}, ${description || null}, 
      ${status}, ${priority}, ${assigned_to || null}, ${parent_task_id || null},
      ${due_date || null}, ${estimated_hours || null},
      ${maxOrder[0].next_order}, ${user.id}
    )
    RETURNING *
  `;

  const task = result[0];

  // Log activity
  await logActivity(user.id, 'created', 'task', task.id, { title, project_id });

  // If assigned, log assignment
  if (assigned_to) {
    await logActivity(user.id, 'assigned', 'task', task.id, { assigned_to });
  }

  return jsonResponse(task, 201);
}

// Update task
async function updateTask(db, taskId, req, user) {
  const body = await req.json();

  const existing = await db`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Task not found' }, 404);
  }

  const task = existing[0];
  const oldStatus = task.status;

  const allowedFields = [
    'title', 'description', 'status', 'priority', 'milestone_id',
    'assigned_to', 'due_date', 'estimated_hours', 'actual_hours'
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

  // Build dynamic update
  const setClause = Object.keys(updates)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const values = Object.values(updates);
  values.push(taskId);

  let query = `
    UPDATE tasks 
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
  `;

  // Set completed_at if moving to done
  if (updates.status === 'done' && oldStatus !== 'done') {
    query += `, completed_at = CURRENT_TIMESTAMP`;
  } else if (updates.status && updates.status !== 'done' && oldStatus === 'done') {
    query += `, completed_at = NULL`;
  }

  query += ` WHERE id = $${values.length} RETURNING *`;

  const result = await db.unsafe(query, values);

  // Log activity
  if (updates.status && updates.status !== oldStatus) {
    await logActivity(user.id, 'status_changed', 'task', taskId, { 
      from: oldStatus, 
      to: updates.status 
    });
  }

  if (updates.assigned_to && updates.assigned_to !== task.assigned_to) {
    await logActivity(user.id, 'reassigned', 'task', taskId, {
      from: task.assigned_to,
      to: updates.assigned_to
    });
  }

  // Update project progress
  await updateProjectProgress(db, task.project_id);

  return jsonResponse(result[0]);
}

// Move task (Kanban drag & drop)
async function moveTask(db, taskId, req, user) {
  const { status, order_index, milestone_id } = await req.json();

  const existing = await db`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Task not found' }, 404);
  }

  const task = existing[0];
  const oldStatus = task.status;

  // Update task position
  let updateQuery = `
    UPDATE tasks SET 
      status = $1,
      order_index = $2,
      updated_at = CURRENT_TIMESTAMP
  `;

  const params = [status, order_index];

  if (milestone_id !== undefined) {
    updateQuery += `, milestone_id = $3`;
    params.push(milestone_id || null);
  }

  if (status === 'done' && oldStatus !== 'done') {
    updateQuery += `, completed_at = CURRENT_TIMESTAMP`;
  } else if (status !== 'done' && oldStatus === 'done') {
    updateQuery += `, completed_at = NULL`;
  }

  updateQuery += ` WHERE id = $${params.length + 1} RETURNING *`;
  params.push(taskId);

  const result = await db.unsafe(updateQuery, params);

  // Reorder other tasks in the column
  await db`
    UPDATE tasks 
    SET order_index = order_index + 1 
    WHERE project_id = ${task.project_id} 
      AND status = ${status} 
      AND id != ${taskId}
      AND order_index >= ${order_index}
  `;

  // Log if status changed
  if (status !== oldStatus) {
    await logActivity(user.id, 'moved', 'task', taskId, { from: oldStatus, to: status });
  }

  // Update project progress
  await updateProjectProgress(db, task.project_id);

  return jsonResponse(result[0]);
}

// Assign task
async function assignTask(db, taskId, req, user) {
  const { assigned_to } = await req.json();

  const existing = await db`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Task not found' }, 404);
  }

  const task = existing[0];

  // Verify assignee exists if provided
  if (assigned_to) {
    const assignee = await db`SELECT id FROM users WHERE id = ${assigned_to}`;
    if (assignee.length === 0) {
      return jsonResponse({ error: 'Assignee not found' }, 404);
    }
  }

  const result = await db`
    UPDATE tasks 
    SET assigned_to = ${assigned_to || null}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${taskId}
    RETURNING *
  `;

  await logActivity(user.id, assigned_to ? 'assigned' : 'unassigned', 'task', taskId, {
    from: task.assigned_to,
    to: assigned_to
  });

  return jsonResponse(result[0]);
}

// Delete task
async function deleteTask(db, taskId, user) {
  const existing = await db`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Task not found' }, 404);
  }

  const task = existing[0];

  // Check permission - task creator or project owner or admin
  const project = await db`SELECT owner_id FROM projects WHERE id = ${task.project_id}`;
  const isOwner = project.length > 0 && project[0].owner_id === user.id;
  const isCreator = task.created_by === user.id;

  if (!isOwner && !isCreator && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  // Delete task (cascades to subtasks)
  await db`DELETE FROM tasks WHERE id = ${taskId}`;

  await logActivity(user.id, 'deleted', 'task', taskId, { title: task.title });

  // Update project progress
  await updateProjectProgress(db, task.project_id);

  return jsonResponse({ success: true, message: 'Task deleted' });
}

// Helper: Update project progress percentage
async function updateProjectProgress(db, projectId) {
  const stats = await db`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'done') as completed
    FROM tasks 
    WHERE project_id = ${projectId}
  `;

  const total = parseInt(stats[0].total) || 0;
  const completed = parseInt(stats[0].completed) || 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  await db`
    UPDATE projects 
    SET progress = ${progress}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${projectId}
  `;
}

export const config = {
  path: "/api/tasks/*"
};
