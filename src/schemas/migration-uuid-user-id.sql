-- Migration: Rename users.id to users.user_id
-- Run once against PolarDB before deploying updated code

ALTER TABLE users RENAME COLUMN id TO user_id;
