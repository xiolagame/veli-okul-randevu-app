-- Apply ONLY to the separately provisioned review database. Never a production migration.
CREATE TABLE review_environment(id TEXT PRIMARY KEY CHECK(id='isolated-store-review'));
INSERT INTO review_environment VALUES('isolated-store-review');
CREATE TABLE review_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE review_deletion_receipts(request_id UUID PRIMARY KEY,user_id TEXT NOT NULL,completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
