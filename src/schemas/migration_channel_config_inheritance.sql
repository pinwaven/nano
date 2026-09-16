-- effective_channel_config(p_channel_id, p_key)
-- Walks up the parent chain and returns the nearest config->p_key that is set — NULL, JSON null,
-- '{}', '[]' and '""' all count as "not set here, ask the parent". NULL when no ancestor sets it.
-- Third sibling of effective_channel_logo / effective_persona_type, generic over the key so
-- `sub_age_display_names`, `admin_tabs` and `locale` (and any later per-channel config) inherit the
-- same way. A scalar is read back as text with `#>> '{}'`.
-- persona_type keeps its own scalar function (it has a 'nano' floor); this one has no default.
--
-- Empty-means-unset matches how the readers already behaved: handleAdminLogin treats an empty
-- admin_tabs array as "no feature flags" and the sub-age readers treat {} as "use defaults", so a
-- child can never have been meaningfully configured to an empty value before this.

CREATE OR REPLACE FUNCTION effective_channel_config(p_channel_id INTEGER, p_key TEXT)
RETURNS JSONB AS $$
DECLARE
    v_val        JSONB;
    v_parent_id  INTEGER;
    v_curr_id    INTEGER := p_channel_id;
    v_depth      INTEGER := 0;
BEGIN
    LOOP
        SELECT config->p_key, parent_channel_id
          INTO v_val, v_parent_id
          FROM channels
         WHERE id = v_curr_id;

        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_val IS NOT NULL
           AND jsonb_typeof(v_val) <> 'null'
           AND v_val <> '{}'::jsonb
           AND v_val <> '[]'::jsonb
           AND v_val <> '""'::jsonb THEN
            RETURN v_val;
        END IF;
        IF v_parent_id IS NULL THEN RETURN NULL; END IF;

        v_depth := v_depth + 1;
        IF v_depth >= 20 THEN RETURN NULL; END IF;  -- cycle guard, same cap as the subtree CTEs
        v_curr_id := v_parent_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
