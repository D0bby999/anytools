-- provider_custom_models (1790320000) is gone with its connection, and so
-- with its user, but only through provider_connections. Every user-owned
-- table names users directly (internal/account delete_test.go), so deleting
-- an account never depends on another table's cascade.
ALTER TABLE provider_custom_models
    ADD CONSTRAINT provider_custom_models_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
