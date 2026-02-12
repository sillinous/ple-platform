/**
 * PLE Platform - Working Groups API
 * Team management with membership and project linkage
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const groupId = pathParts[2]; // /api/groups/:id
  const action = pathParts[3]; // /api/groups/:id/join, /api/groups/:id/members

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/groups - List groups
    if (method === 'GET' && !groupId) {
      return await listGroups(db, url, user);
    }

    // GET /api/groups/:id - Get single group
    if (method === 'GET' && groupId && !action) {
      return await getGroup(db, groupId, user);
    }

    // GET /api/groups/:id/members - Get group members
    if (method === 'GET' && groupId && action === 'members') {
      return await getMembers(db, groupId);
    }

    // Authenticated routes
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    // POST /api/groups - Create group
    if (method === 'POST' && !groupId) {
      return await createGroup(db, req, user);
    }

    // PUT /api/groups/:id - Update group
    if (method === 'PUT' && groupId && !action) {
      return await updateGroup(db, groupId, req, user);
    }

    // POST /api/groups/:id/join - Join group
    if (method === 'POST' && groupId && action === 'join') {
      return await joinGroup(db, groupId, user);
    }

    // POST /api/groups/:id/leave - Leave group
    if (method === 'POST' && groupId && action === 'leave') {
      return await leaveGroup(db, groupId, user);
    }

    // POST /api/groups/:id/members - Manage members
    if (method === 'POST' && groupId && action === 'members') {
      return await manageMembers(db, groupId, req, user);
    }

    // DELETE /api/groups/:id - Disband group
    if (method === 'DELETE' && groupId) {
      return await disbandGroup(db, groupId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Working Groups API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List working groups
async function listGroups(db, url, user) {
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');
  const myGroups = url.searchParams.get('my_groups') === 'true';
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  let query = `
    SELECT wg.*, 
           u.display_name as lead_name,
           u.avatar_url as lead_avatar,
           p.title as project_title,
           p.slug as project_slug,
           (SELECT COUNT(*) FROM working_group_members wgm WHERE wgm.group_id = wg.id AND wgm.left_at IS NULL) as member_count
    FROM working_groups wg
    LEFT JOIN users u ON wg.lead_id = u.id
    LEFT JOIN projects p ON wg.project_id = p.id
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;

  if (!user) {
    query += ` AND wg.visibility = 'public'`;
  }

  if (status) {
    query += ` AND wg.status = $${paramIndex++}`;
    params.push(status);
  }

  if (projectId) {
    query += ` AND wg.project_id = $${paramIndex++}`;
    params.push(projectId);
  }

  if (myGroups && user) {
    query += ` AND EXISTS (
      SELECT 1 FROM working_group_members wgm 
      WHERE wgm.group_id = wg.id AND wgm.user_id = $${paramIndex++} AND wgm.left_at IS NULL
    )`;
    params.push(user.id);
  }

  query += ` ORDER BY wg.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const groups = await db.unsafe(query, params);

  return jsonResponse({ groups });
}

// Get single group
async function getGroup(db, groupId, user) {
  const groups = await db`
    SELECT wg.*, 
           u.display_name as lead_name,
           u.email as lead_email,
           u.avatar_url as lead_avatar,
           p.title as project_title,
           p.slug as project_slug
    FROM working_groups wg
    LEFT JOIN users u ON wg.lead_id = u.id
    LEFT JOIN projects p ON wg.project_id = p.id
    WHERE wg.id = ${groupId} OR wg.slug = ${groupId}
  `;

  if (groups.length === 0) {
    return jsonResponse({ error: 'Working group not found' }, 404);
  }

  const group = groups[0];

  // Check visibility
  if (group.visibility !== 'public' && !user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  // Get members
  const members = await db`
    SELECT wgm.*, u.display_name, u.email, u.avatar_url
    FROM working_group_members wgm
    JOIN users u ON wgm.user_id = u.id
    WHERE wgm.group_id = ${group.id} AND wgm.left_at IS NULL
    ORDER BY 
      CASE wgm.role WHEN 'lead' THEN 1 WHEN 'member' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
      wgm.joined_at
  `;

  // Get recent activity
  const activity = await db`
    SELECT al.*, u.display_name as user_name
    FROM activity_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.entity_type = 'working_group' AND al.entity_id = ${group.id}
    ORDER BY al.created_at DESC
    LIMIT 20
  `;

  // Get related tasks if linked to project
  let tasks = [];
  if (group.project_id) {
    tasks = await db`
      SELECT t.*, u.display_name as assignee_name
      FROM tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.project_id = ${group.project_id}
        AND t.assigned_to IN (SELECT user_id FROM working_group_members WHERE group_id = ${group.id})
      ORDER BY t.updated_at DESC
      LIMIT 10
    `;
  }

  // Check if current user is member
  let currentUserMembership = null;
  if (user) {
    const membership = await db`
      SELECT * FROM working_group_members 
      WHERE group_id = ${group.id} AND user_id = ${user.id} AND left_at IS NULL
    `;
    currentUserMembership = membership.length > 0 ? membership[0] : null;
  }

  return jsonResponse({
    ...group,
    members,
    activity,
    tasks,
    currentUserMembership
  });
}

// Get group members
async function getMembers(db, groupId) {
  const members = await db`
    SELECT wgm.*, u.display_name, u.email, u.avatar_url, u.bio
    FROM working_group_members wgm
    JOIN users u ON wgm.user_id = u.id
    WHERE wgm.group_id = ${groupId} AND wgm.left_at IS NULL
    ORDER BY 
      CASE wgm.role WHEN 'lead' THEN 1 WHEN 'member' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
      wgm.joined_at
  `;

  return jsonResponse({ members });
}

// Create working group
async function createGroup(db, req, user) {
  const body = await req.json();
  const {
    name,
    description,
    project_id,
    visibility = 'members'
  } = body;

  if (!name) {
    return jsonResponse({ error: 'Name is required' }, 400);
  }

  // Generate slug
  const baseSlug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const existing = await db`SELECT slug FROM working_groups WHERE slug LIKE ${baseSlug + '%'}`;
  let slug = baseSlug;
  if (existing.length > 0) {
    slug = `${baseSlug}-${existing.length + 1}`;
  }

  const result = await db`
    INSERT INTO working_groups (name, slug, description, project_id, lead_id, visibility, status)
    VALUES (${name}, ${slug}, ${description || null}, ${project_id || null}, ${user.id}, ${visibility}, 'forming')
    RETURNING *
  `;

  const group = result[0];

  // Add creator as lead member
  await db`
    INSERT INTO working_group_members (group_id, user_id, role)
    VALUES (${group.id}, ${user.id}, 'lead')
  `;

  await logActivity(user.id, 'created', 'working_group', group.id, { name });

  return jsonResponse(group, 201);
}

// Update working group
async function updateGroup(db, groupId, req, user) {
  const body = await req.json();

  const existing = await db`SELECT * FROM working_groups WHERE id = ${groupId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Working group not found' }, 404);
  }

  const group = existing[0];

  // Check permission - lead or admin
  if (group.lead_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  const allowedFields = ['name', 'description', 'status', 'visibility', 'project_id'];
  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400);
  }

  const setClause = Object.keys(updates)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(', ');

  const values = Object.values(updates);
  values.push(groupId);

  const query = `
    UPDATE working_groups 
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $${values.length}
    RETURNING *
  `;

  const result = await db.unsafe(query, values);

  await logActivity(user.id, 'updated', 'working_group', groupId, { fields: Object.keys(updates) });

  return jsonResponse(result[0]);
}

// Join working group
async function joinGroup(db, groupId, user) {
  const existing = await db`SELECT * FROM working_groups WHERE id = ${groupId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Working group not found' }, 404);
  }

  const group = existing[0];

  if (group.status === 'disbanded') {
    return jsonResponse({ error: 'Cannot join a disbanded group' }, 400);
  }

  // Check if already member
  const membership = await db`
    SELECT * FROM working_group_members 
    WHERE group_id = ${groupId} AND user_id = ${user.id} AND left_at IS NULL
  `;

  if (membership.length > 0) {
    return jsonResponse({ error: 'Already a member' }, 400);
  }

  // Rejoin if previously left
  const previousMembership = await db`
    SELECT * FROM working_group_members 
    WHERE group_id = ${groupId} AND user_id = ${user.id} AND left_at IS NOT NULL
  `;

  if (previousMembership.length > 0) {
    await db`
      UPDATE working_group_members 
      SET left_at = NULL, joined_at = CURRENT_TIMESTAMP, role = 'member'
      WHERE group_id = ${groupId} AND user_id = ${user.id}
    `;
  } else {
    await db`
      INSERT INTO working_group_members (group_id, user_id, role)
      VALUES (${groupId}, ${user.id}, 'member')
    `;
  }

  await logActivity(user.id, 'joined', 'working_group', groupId, { group_name: group.name });

  return jsonResponse({ success: true, message: 'Joined working group' });
}

// Leave working group
async function leaveGroup(db, groupId, user) {
  const existing = await db`
    SELECT * FROM working_group_members 
    WHERE group_id = ${groupId} AND user_id = ${user.id} AND left_at IS NULL
  `;

  if (existing.length === 0) {
    return jsonResponse({ error: 'Not a member of this group' }, 400);
  }

  const membership = existing[0];

  // Lead cannot leave without transferring leadership
  if (membership.role === 'lead') {
    const otherMembers = await db`
      SELECT COUNT(*) as count FROM working_group_members 
      WHERE group_id = ${groupId} AND user_id != ${user.id} AND left_at IS NULL
    `;

    if (parseInt(otherMembers[0].count) > 0) {
      return jsonResponse({ error: 'Please transfer leadership before leaving' }, 400);
    }
  }

  await db`
    UPDATE working_group_members 
    SET left_at = CURRENT_TIMESTAMP
    WHERE group_id = ${groupId} AND user_id = ${user.id}
  `;

  await logActivity(user.id, 'left', 'working_group', groupId, {});

  return jsonResponse({ success: true, message: 'Left working group' });
}

// Manage members (add, remove, change role)
async function manageMembers(db, groupId, req, user) {
  const body = await req.json();
  const { action, user_id, role } = body;

  // Check permission - lead or admin
  const group = await db`SELECT * FROM working_groups WHERE id = ${groupId}`;
  if (group.length === 0) {
    return jsonResponse({ error: 'Working group not found' }, 404);
  }

  if (group[0].lead_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  if (!user_id) {
    return jsonResponse({ error: 'User ID required' }, 400);
  }

  switch (action) {
    case 'add': {
      const existingMember = await db`
        SELECT * FROM working_group_members 
        WHERE group_id = ${groupId} AND user_id = ${user_id} AND left_at IS NULL
      `;

      if (existingMember.length > 0) {
        return jsonResponse({ error: 'User is already a member' }, 400);
      }

      await db`
        INSERT INTO working_group_members (group_id, user_id, role)
        VALUES (${groupId}, ${user_id}, ${role || 'member'})
        ON CONFLICT (group_id, user_id) 
        DO UPDATE SET left_at = NULL, role = ${role || 'member'}
      `;

      await logActivity(user.id, 'added_member', 'working_group', groupId, { added_user_id: user_id });
      return jsonResponse({ success: true, message: 'Member added' });
    }

    case 'remove': {
      await db`
        UPDATE working_group_members 
        SET left_at = CURRENT_TIMESTAMP
        WHERE group_id = ${groupId} AND user_id = ${user_id}
      `;

      await logActivity(user.id, 'removed_member', 'working_group', groupId, { removed_user_id: user_id });
      return jsonResponse({ success: true, message: 'Member removed' });
    }

    case 'change_role': {
      if (!role) {
        return jsonResponse({ error: 'Role required' }, 400);
      }

      await db`
        UPDATE working_group_members 
        SET role = ${role}
        WHERE group_id = ${groupId} AND user_id = ${user_id} AND left_at IS NULL
      `;

      // If promoting to lead, update group lead
      if (role === 'lead') {
        // Demote current lead
        await db`
          UPDATE working_group_members 
          SET role = 'member'
          WHERE group_id = ${groupId} AND role = 'lead' AND user_id != ${user_id}
        `;

        await db`UPDATE working_groups SET lead_id = ${user_id} WHERE id = ${groupId}`;
      }

      await logActivity(user.id, 'changed_role', 'working_group', groupId, { 
        target_user_id: user_id, 
        new_role: role 
      });
      return jsonResponse({ success: true, message: 'Role updated' });
    }

    default:
      return jsonResponse({ error: 'Invalid action' }, 400);
  }
}

// Disband working group
async function disbandGroup(db, groupId, user) {
  const existing = await db`SELECT * FROM working_groups WHERE id = ${groupId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Working group not found' }, 404);
  }

  const group = existing[0];

  if (group.lead_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  await db`
    UPDATE working_groups 
    SET status = 'disbanded', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${groupId}
  `;

  // Mark all memberships as ended
  await db`
    UPDATE working_group_members 
    SET left_at = CURRENT_TIMESTAMP
    WHERE group_id = ${groupId} AND left_at IS NULL
  `;

  await logActivity(user.id, 'disbanded', 'working_group', groupId, { name: group.name });

  return jsonResponse({ success: true, message: 'Working group disbanded' });
}

export const config = {
  path: "/api/groups/*"
};
