// Resolves a user's *effective* persona: an active per-user override (see
// migration_users_persona_override.sql) takes priority over the channel default.
// Shared by every call site that used to read channel.config.persona_type directly —
// see CLAUDE.md's persona-subscriptions plan for the full list.
function resolveEffectivePersona({ channelPersonaType, personaOverrideType, personaOverrideExpiresAt }) {
    const overrideActive = !!personaOverrideType
        && !!personaOverrideExpiresAt
        && new Date(personaOverrideExpiresAt) > new Date();
    return overrideActive ? personaOverrideType : (channelPersonaType || 'nano');
}

// Viva paywall gate — only Viva has ever been a paid persona, so this is the one place
// "does this user have an active grant" is checked, independent of channel default.
function hasActiveVivaAccess({ persona_override_type, persona_override_expires_at }) {
    return persona_override_type === 'viva'
        && !!persona_override_expires_at
        && new Date(persona_override_expires_at) > new Date();
}

module.exports = { resolveEffectivePersona, hasActiveVivaAccess };
