package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/D0bby999/anytools/internal/app"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// verifyCmd is the restore drill's smoke test: run it against a restored
// database and data directory with the escrowed key. It reads only; it never
// seeds, migrates or repairs anything.
func verifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "verify",
		Short: "Check that a database, data directory and encryption key belong together",
		Long: "Verifies the encryption key against the database sentinel, decrypts every\n" +
			"encrypted column, and checks every document's files exist in the data\n" +
			"directory. Exits non-zero on any problem. Read-only.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			// Not config.Load: that enforces the SERVER's boot contract (a
			// gateway token, for one), and a restore drill on a spare box has
			// no gateway. These are the only three inputs verify has.
			dsn, err := resolveDSN()
			if err != nil {
				return err
			}
			key := strings.TrimSpace(config.Getenv(config.EnvPrefix + "ENCRYPTION_KEY"))
			if key == "" {
				return fmt.Errorf("%sENCRYPTION_KEY is not set: verify needs the escrowed key", config.EnvPrefix)
			}
			if _, err := crypto.DeriveKey(key); err != nil {
				return fmt.Errorf("%sENCRYPTION_KEY is not a valid key: %w", config.EnvPrefix, err)
			}
			dataDir := strings.TrimSpace(config.Getenv(config.EnvPrefix + "DATA_DIR"))
			if dataDir == "" {
				return fmt.Errorf("%sDATA_DIR is not set: verify needs the restored data directory", config.EnvPrefix)
			}
			pool, err := pg.Open(cmd.Context(), dsn)
			if err != nil {
				return err
			}
			defer pool.Close()

			report, err := app.Verify(cmd.Context(), pool, key, dataDir)
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "secrets checked: %d\ndocuments checked: %d\noriginals in learners' Google Drives (not checked here): %d\n",
				report.SecretsChecked, report.DocumentsChecked, report.InDrive)
			for _, p := range report.Problems {
				fmt.Fprintf(out, "PROBLEM: %s\n", p)
			}
			if !report.OK() {
				return fmt.Errorf("verify: %d problem(s)", len(report.Problems))
			}
			fmt.Fprintln(out, "OK: key, secrets and files are consistent")
			return nil
		},
	}
}
