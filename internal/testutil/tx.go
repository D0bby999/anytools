package testutil

import "github.com/jackc/pgx/v5"

// Tx is the transaction handle WithTx hands to a test body.
type Tx = pgx.Tx
