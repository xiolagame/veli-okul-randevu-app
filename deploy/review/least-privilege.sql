-- Dedicated review PostgreSQL only; run by the offline initializer.
CREATE ROLE review_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT service_role TO review_app;
GRANT CONNECT ON DATABASE veli_review TO review_app;
GRANT USAGE ON SCHEMA public TO review_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO review_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO review_app;
-- Set the review_app password interactively / via the secret manager after initialization.
