-- effective_channel_logo(p_channel_id)
-- Walks up the parent chain and returns the nearest logo_url that is non-null/non-empty.
-- Returns NULL if no ancestor (including the channel itself) has a logo.

CREATE OR REPLACE FUNCTION effective_channel_logo(p_channel_id INTEGER)
RETURNS TEXT AS $$
DECLARE
    v_logo       TEXT;
    v_parent_id  INTEGER;
    v_curr_id    INTEGER := p_channel_id;
BEGIN
    LOOP
        SELECT logo_url, parent_channel_id
          INTO v_logo, v_parent_id
          FROM channels
         WHERE id = v_curr_id;

        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_logo IS NOT NULL AND v_logo <> '' THEN RETURN v_logo; END IF;
        IF v_parent_id IS NULL THEN RETURN NULL; END IF;

        v_curr_id := v_parent_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
