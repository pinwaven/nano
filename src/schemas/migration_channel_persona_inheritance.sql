-- effective_persona_type(p_channel_id)
-- Walks up the parent chain and returns the nearest non-empty config->>'persona_type';
-- 'nano' when no ancestor (including the channel itself) sets one, or the id is unknown.
-- Sibling of effective_channel_logo (migration_channel_logo_inheritance.sql): a sub-channel
-- created under aeviva-china with config '{}' must run Viva, not silently fall back to Nano.
-- Every server-side "what persona does this channel default to" read goes through this;
-- config->>'persona_type' alone is the channel's OWN setting, not its effective one.

CREATE OR REPLACE FUNCTION effective_persona_type(p_channel_id INTEGER)
RETURNS TEXT AS $$
DECLARE
    v_persona    TEXT;
    v_parent_id  INTEGER;
    v_curr_id    INTEGER := p_channel_id;
    v_depth      INTEGER := 0;
BEGIN
    LOOP
        SELECT config->>'persona_type', parent_channel_id
          INTO v_persona, v_parent_id
          FROM channels
         WHERE id = v_curr_id;

        IF NOT FOUND THEN RETURN 'nano'; END IF;
        IF v_persona IS NOT NULL AND v_persona <> '' THEN RETURN v_persona; END IF;
        IF v_parent_id IS NULL THEN RETURN 'nano'; END IF;

        v_depth := v_depth + 1;
        IF v_depth >= 20 THEN RETURN 'nano'; END IF;  -- cycle guard, same cap as the subtree CTEs
        v_curr_id := v_parent_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
