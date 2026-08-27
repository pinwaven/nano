const { pool } = require('../lib/db');
const {
    signChannelAdminToken,
    CHANNEL_ADMIN_FULL_PERMS,
    expandPermissions,
    requirePermission,
    verifySubchannelOwnership,
} = require('../lib/auth');

async function handleGetAdminAccounts(adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    const canManageOwn = isChannel && !requirePermission(adminCtx, 'admin-accounts:read');
    const canManageSubs = isChannel && adminCtx.canManageSubchannels;
    if (isChannel && !canManageOwn && !canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cols = `a.id, a.username, a.created_at, a.channel_id, a.is_channel_admin, a.role_id, a.permissions_override, a.permissions, r.name AS role_name, r.label AS role_label, c.name AS channel_name`;
        let result;
        if (isChannel) {
            if (canManageOwn && canManageSubs) {
                result = await pool.query(
                    `SELECT ${cols} FROM admin_accounts a LEFT JOIN admin_channel_roles r ON r.id = a.role_id JOIN channels c ON a.channel_id = c.id WHERE a.channel_id = $1 OR c.parent_channel_id = $1 ORDER BY a.created_at ASC`,
                    [adminCtx.channelId]
                );
            } else if (canManageOwn) {
                result = await pool.query(
                    `SELECT ${cols} FROM admin_accounts a LEFT JOIN admin_channel_roles r ON r.id = a.role_id JOIN channels c ON a.channel_id = c.id WHERE a.channel_id = $1 ORDER BY a.created_at ASC`,
                    [adminCtx.channelId]
                );
            } else {
                result = await pool.query(
                    `SELECT ${cols} FROM admin_accounts a LEFT JOIN admin_channel_roles r ON r.id = a.role_id JOIN channels c ON a.channel_id = c.id WHERE c.parent_channel_id = $1 ORDER BY a.created_at ASC`,
                    [adminCtx.channelId]
                );
            }
        } else {
            result = await pool.query(
                `SELECT ${cols} FROM admin_accounts a LEFT JOIN admin_channel_roles r ON r.id = a.role_id LEFT JOIN channels c ON a.channel_id = c.id ORDER BY a.created_at ASC`
            );
        }
        return { success: true, accounts: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminAccount(body, adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    const canManageOwn = isChannel && !requirePermission(adminCtx, 'admin-accounts:write');
    const canManageSubs = isChannel && adminCtx.canManageSubchannels;
    if (isChannel && !canManageOwn && !canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
    const { username, password, channel_id, role_id, permissions_override, is_channel_admin } = body || {};
    if (!username || !password) return { statusCode: 400, success: false, error: 'Username and password required' };
    // Only superadmin can create channel admin accounts
    const makeChannelAdmin = !isChannel && !!is_channel_admin && !!channel_id;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (isChannel) {
            const targetCid = channel_id ? parseInt(channel_id) : null;
            if (targetCid === null) return { statusCode: 403, success: false, error: 'Forbidden' };
            if (targetCid === adminCtx.channelId) {
                if (!canManageOwn) return { statusCode: 403, success: false, error: 'Forbidden' };
            } else {
                if (!canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
                const owns = await verifySubchannelOwnership(targetCid, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
            }
        }
        // For channel admins, auto-assign the global 'channel_admin' role for proper display
        let sanitizedRoleId = role_id ? parseInt(role_id) : null;
        if (makeChannelAdmin) {
            const caRole = await pool.query(`SELECT id FROM admin_channel_roles WHERE channel_id IS NULL AND name = 'channel_admin'`);
            if (caRole.rows[0]) sanitizedRoleId = caRole.rows[0].id;
        } else if (sanitizedRoleId && isChannel) {
            const roleCheck = await pool.query('SELECT channel_id FROM admin_channel_roles WHERE id = $1', [sanitizedRoleId]);
            const roleCid = roleCheck.rows[0]?.channel_id;
            if (roleCid !== null && roleCid !== adminCtx.channelId) sanitizedRoleId = null;
        }
        // Sanitize overrides: only perms the actor holds and within CHANNEL_ADMIN_FULL_PERMS ceiling
        const actorPerms = isChannel ? (adminCtx.perms || []) : null;
        const sanitizedOverrides = makeChannelAdmin ? [] : Array.isArray(permissions_override)
            ? permissions_override.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p) && (!actorPerms || actorPerms.includes(p)))
            : [];
        const { scryptSync, randomBytes } = require('crypto');
        const salt = randomBytes(16).toString('hex');
        const hash = scryptSync(password, salt, 64).toString('hex');
        const result = await pool.query(
            `INSERT INTO admin_accounts (username, password_hash, channel_id, is_channel_admin, role_id, permissions_override)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, username, created_at, channel_id, is_channel_admin, role_id, permissions_override`,
            [username, `${salt}:${hash}`, channel_id || null, makeChannelAdmin, sanitizedRoleId, sanitizedOverrides]
        );
        return { success: true, account: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { statusCode: 409, success: false, error: 'Username already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutAdminAccount(id, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        const canManageOwn = !requirePermission(adminCtx, 'admin-accounts:write');
        const canManageSubs = adminCtx.canManageSubchannels;
        if (!canManageOwn && !canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const acct = await pool.query('SELECT channel_id FROM admin_accounts WHERE id = $1', [id]);
        if (acct.rows.length === 0) return { statusCode: 404, success: false, error: 'Not found' };
        const targetCid = parseInt(acct.rows[0].channel_id);
        if (targetCid === adminCtx.channelId) {
            if (!canManageOwn) return { statusCode: 403, success: false, error: 'Forbidden' };
        } else {
            if (!canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
            const owns = await verifySubchannelOwnership(targetCid, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
    }
    const { password, role_id, permissions_override } = body || {};
    if (!password && role_id === undefined && permissions_override === undefined) return { statusCode: 400, success: false, error: 'Nothing to update' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (password) {
            const { scryptSync, randomBytes } = require('crypto');
            const salt = randomBytes(16).toString('hex');
            const hash = scryptSync(password, salt, 64).toString('hex');
            await pool.query('UPDATE admin_accounts SET password_hash = $1 WHERE id = $2', [`${salt}:${hash}`, id]);
        }
        if (role_id !== undefined) {
            const isChannel = adminCtx?.role === 'channel';
            let sanitizedRoleId = role_id ? parseInt(role_id) : null;
            if (sanitizedRoleId && isChannel) {
                const roleCheck = await pool.query('SELECT channel_id FROM admin_channel_roles WHERE id = $1', [sanitizedRoleId]);
                const roleCid = roleCheck.rows[0]?.channel_id;
                if (roleCid !== null && roleCid !== adminCtx.channelId) sanitizedRoleId = null;
            }
            await pool.query('UPDATE admin_accounts SET role_id = $1 WHERE id = $2', [sanitizedRoleId, id]);
        }
        if (permissions_override !== undefined) {
            const isChannel = adminCtx?.role === 'channel';
            const actorPerms = isChannel ? (adminCtx.perms || []) : null;
            const sanitized = Array.isArray(permissions_override)
                ? permissions_override.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p) && (!actorPerms || actorPerms.includes(p)))
                : [];
            await pool.query('UPDATE admin_accounts SET permissions_override = $1 WHERE id = $2', [sanitized, id]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAdminAccount(id, adminCtx) {
    if (adminCtx?.role === 'channel') {
        const canManageOwn = !requirePermission(adminCtx, 'admin-accounts:write');
        const canManageSubs = adminCtx.canManageSubchannels;
        if (!canManageOwn && !canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
        if (adminCtx.accountId && parseInt(id) === adminCtx.accountId) return { statusCode: 400, success: false, error: 'Cannot delete your own account' };
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const acct = await pool.query('SELECT channel_id FROM admin_accounts WHERE id = $1', [id]);
        if (acct.rows.length === 0) return { statusCode: 404, success: false, error: 'Not found' };
        const targetCid = parseInt(acct.rows[0].channel_id);
        if (targetCid === adminCtx.channelId) {
            if (!canManageOwn) return { statusCode: 403, success: false, error: 'Forbidden' };
        } else {
            if (!canManageSubs) return { statusCode: 403, success: false, error: 'Forbidden' };
            const owns = await verifySubchannelOwnership(targetCid, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const remaining = await pool.query('SELECT COUNT(*) FROM admin_accounts');
        if (parseInt(remaining.rows[0].count) <= 1) return { statusCode: 400, success: false, error: 'Cannot delete the last admin account' };
        await pool.query('DELETE FROM admin_accounts WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        // Without a statusCode the router replies 200 and the panel's axios
        // never throws — the delete fails with no visible error at all.
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetAdminChannelRoles(adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = isChannel ? adminCtx.channelId : null;
        const result = await pool.query(
            `SELECT * FROM admin_channel_roles WHERE channel_id IS NULL OR channel_id = $1 ORDER BY channel_id NULLS FIRST, name`,
            [cid]
        );
        return { success: true, roles: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAdminChannelRole(body, adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    if (isChannel) {
        const check = requirePermission(adminCtx, 'admin-accounts:write');
        if (check) return check;
    }
    const { name, label, permissions } = body || {};
    if (!name || !label) return { statusCode: 400, success: false, error: 'name and label required' };
    const cid = isChannel ? adminCtx.channelId : null;
    // Channel admins can only set perms within CHANNEL_ADMIN_FULL_PERMS and their own perms
    const actorPerms = isChannel ? (adminCtx.perms || []) : null;
    const safePerms = Array.isArray(permissions)
        ? permissions.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p) && (!actorPerms || actorPerms.includes(p)))
        : [];
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        // Channel roles cannot shadow global role names
        if (cid !== null) {
            const conflict = await pool.query('SELECT id FROM admin_channel_roles WHERE channel_id IS NULL AND name = $1', [name]);
            if (conflict.rows.length > 0) return { statusCode: 409, success: false, error: 'Name conflicts with a global role' };
        }
        const result = await pool.query(
            `INSERT INTO admin_channel_roles (channel_id, name, label, permissions) VALUES ($1, $2, $3, $4) RETURNING *`,
            [cid, name, label, safePerms]
        );
        return { success: true, role: result.rows[0] };
    } catch (err) {
        if (err.code === '23505') return { statusCode: 409, success: false, error: 'Role name already exists for this channel' };
        return { success: false, error: err.message };
    }
}

async function handlePutAdminChannelRole(id, body, adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    if (isChannel) {
        const check = requirePermission(adminCtx, 'admin-accounts:write');
        if (check) return check;
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const existing = await pool.query('SELECT channel_id FROM admin_channel_roles WHERE id = $1', [id]);
        if (!existing.rows[0]) return { statusCode: 404, success: false, error: 'Not found' };
        if (existing.rows[0].channel_id === null) return { statusCode: 403, success: false, error: 'Global roles cannot be modified' };
        if (isChannel && existing.rows[0].channel_id !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        const { label, permissions } = body || {};
        const updates = [];
        const params = [];
        if (label) { params.push(label); updates.push(`label = $${params.length}`); }
        if (Array.isArray(permissions)) {
            const actorPerms = isChannel ? (adminCtx.perms || []) : null;
            const safePerms = permissions.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p) && (!actorPerms || actorPerms.includes(p)));
            params.push(safePerms); updates.push(`permissions = $${params.length}`);
        }
        if (!updates.length) return { statusCode: 400, success: false, error: 'Nothing to update' };
        params.push(id);
        await pool.query(`UPDATE admin_channel_roles SET ${updates.join(',')} WHERE id = $${params.length}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAdminChannelRole(id, adminCtx) {
    const isChannel = adminCtx?.role === 'channel';
    if (isChannel) {
        const check = requirePermission(adminCtx, 'admin-accounts:write');
        if (check) return check;
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const existing = await pool.query('SELECT channel_id FROM admin_channel_roles WHERE id = $1', [id]);
        if (!existing.rows[0]) return { statusCode: 404, success: false, error: 'Not found' };
        if (existing.rows[0].channel_id === null) return { statusCode: 403, success: false, error: 'Global roles cannot be deleted' };
        if (isChannel && existing.rows[0].channel_id !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        const inUse = await pool.query('SELECT COUNT(*) FROM admin_accounts WHERE role_id = $1', [id]);
        if (parseInt(inUse.rows[0].count) > 0) return { statusCode: 400, success: false, error: 'Role is assigned to one or more accounts' };
        await pool.query('DELETE FROM admin_channel_roles WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleAdminLogin(body) {
    const { username, password } = body || {};
    if (!username || !password) return { statusCode: 400, success: false, error: 'Missing credentials' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(`
            SELECT a.id, a.password_hash, a.channel_id,
                   a.is_channel_admin, a.permissions_override,
                   a.permissions AS legacy_perms,
                   r.permissions AS role_permissions
            FROM admin_accounts a
            LEFT JOIN admin_channel_roles r ON r.id = a.role_id
            WHERE a.username = $1
        `, [username]);
        if (result.rows.length === 0) {
            await new Promise(r => setTimeout(r, 200));
            return { statusCode: 401, success: false, error: 'Invalid credentials' };
        }
        const row = result.rows[0];
        const { scryptSync, timingSafeEqual } = require('crypto');
        const [salt, storedHash] = row.password_hash.split(':');
        const derivedKey = scryptSync(password, salt, 64);
        const match = timingSafeEqual(derivedKey, Buffer.from(storedHash, 'hex'));
        if (!match) return { statusCode: 401, success: false, error: 'Invalid credentials' };

        if (row.channel_id == null) {
            return { success: true, token: process.env.API_BEARER_TOKEN, role: 'superadmin', channel_id: null, allowed_tabs: null };
        }

        const chRes = await pool.query(`SELECT name, effective_channel_logo(id) AS logo_url, config->'admin_tabs' AS admin_tabs, can_manage_subchannels, can_customize_store, can_manage_warehouses, autonomous FROM channels WHERE id = $1`, [row.channel_id]);
        const channelRow = chRes.rows[0] || {};
        // admin_tabs on a channel are feature flags ("is store enabled?"), not permission ceilings
        const channelFeatureTabs = Array.isArray(channelRow.admin_tabs) ? channelRow.admin_tabs : [];
        const channelActivePerms = channelFeatureTabs.length > 0 ? expandPermissions(channelFeatureTabs) : null;

        // Permission resolution — three cases in priority order:
        let resolvedPerms;
        if (row.is_channel_admin) {
            // Root channel admin: always gets full hardcoded rights — feature flags don't restrict access
            resolvedPerms = CHANNEL_ADMIN_FULL_PERMS;
        } else if (Array.isArray(row.role_permissions) && row.role_permissions.length > 0) {
            // Staff account with assigned role + optional per-account overrides
            const combined = [...new Set([...row.role_permissions, ...(row.permissions_override || [])])];
            // Staff can never exceed channel admin ceiling
            resolvedPerms = combined.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p));
        } else {
            // Legacy fallback: old permissions column (tab names or resource:action strings)
            const legacyExpanded = expandPermissions(Array.isArray(row.legacy_perms) ? row.legacy_perms : []);
            resolvedPerms = legacyExpanded.length > 0
                ? legacyExpanded.filter(p => CHANNEL_ADMIN_FULL_PERMS.includes(p))
                : (channelActivePerms || CHANNEL_ADMIN_FULL_PERMS);
        }

        const isAutonomous = channelRow.autonomous ?? false;
        if (isAutonomous) resolvedPerms = [...CHANNEL_ADMIN_FULL_PERMS];

        // Derive tab names from resolved perms for nav visibility (existing behavior preserved)
        const tabs = isAutonomous
            ? [...new Set(CHANNEL_ADMIN_FULL_PERMS.map(p => p.split(':')[0]))]
            : [...new Set(resolvedPerms.map(p => p.split(':')[0]))];
        const cms = isAutonomous || (channelRow.can_manage_subchannels ?? false);
        const canCustomizeStore = isAutonomous || (channelRow.can_customize_store ?? false);
        const canManageWarehouses = isAutonomous || (channelRow.can_manage_warehouses ?? false);
        const token = signChannelAdminToken({ sub: row.id, username, cid: row.channel_id, tabs, perms: resolvedPerms, cms, cmw: canManageWarehouses, auto: isAutonomous });
        return { success: true, token, role: 'channel', channel_id: row.channel_id,
                 channel_name: channelRow.name || '', channel_logo: channelRow.logo_url || '',
                 allowed_tabs: tabs, allowed_perms: resolvedPerms, can_manage_subchannels: cms,
                 can_customize_store: canCustomizeStore, can_manage_warehouses: canManageWarehouses,
                 autonomous: isAutonomous };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetAdminAccounts,
    handlePostAdminAccount,
    handlePutAdminAccount,
    handleDeleteAdminAccount,
    handleGetAdminChannelRoles,
    handlePostAdminChannelRole,
    handlePutAdminChannelRole,
    handleDeleteAdminChannelRole,
    handleAdminLogin,
};
