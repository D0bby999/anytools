package cli

import (
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/spf13/cobra"

	"github.com/D0bby999/anytools/internal/config"
)

var migrationsDir string

func migrateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Database migration management",
		Long: "Applies or rolls back schema migrations. Deliberately NOT run on boot:\n" +
			"a server that migrates as it starts turns every restart into a schema\n" +
			"change and makes a rollback impossible to sequence.",
	}
	cmd.PersistentFlags().StringVar(&migrationsDir, "migrations-dir", "",
		"path to migrations directory (default: ./migrations, or ANYTOOLS_MIGRATIONS_DIR)")
	cmd.AddCommand(migrateUpCmd(), migrateDownCmd(), migrateVersionCmd(), migrateForceCmd())
	return cmd
}

func resolveMigrationsDir() string {
	if migrationsDir != "" {
		return migrationsDir
	}
	if v := config.Getenv(config.EnvPrefix + "MIGRATIONS_DIR"); v != "" {
		return v
	}
	return "migrations"
}

// resolveDSN reads the DSN from the environment only. It never comes from a
// config file: a connection string carries credentials.
func resolveDSN() (string, error) {
	dsn := config.Getenv(config.EnvPrefix + "POSTGRES_DSN")
	if dsn == "" {
		return "", fmt.Errorf("%sPOSTGRES_DSN is not set", config.EnvPrefix)
	}
	return dsn, nil
}

func newMigrator() (*migrate.Migrate, error) {
	dsn, err := resolveDSN()
	if err != nil {
		return nil, err
	}
	m, err := migrate.New("file://"+resolveMigrationsDir(), dsn)
	if err != nil {
		return nil, fmt.Errorf("create migrator: %w", err)
	}
	return m, nil
}

func migrateUpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "up",
		Short: "Apply all pending migrations",
		RunE: func(*cobra.Command, []string) error {
			m, err := newMigrator()
			if err != nil {
				return err
			}
			defer m.Close()

			if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
				return fmt.Errorf("migrate up: %w", err)
			}
			v, dirty, _ := m.Version()
			slog.Info("migration complete", "version", v, "dirty", dirty)
			return nil
		},
	}
}

func migrateDownCmd() *cobra.Command {
	var steps int
	cmd := &cobra.Command{
		Use:   "down",
		Short: "Roll back migrations (default: 1 step)",
		RunE: func(*cobra.Command, []string) error {
			m, err := newMigrator()
			if err != nil {
				return err
			}
			defer m.Close()

			if steps <= 0 {
				steps = 1
			}
			if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
				return fmt.Errorf("migrate down: %w", err)
			}
			v, dirty, _ := m.Version()
			slog.Info("rollback complete", "version", v, "dirty", dirty)
			return nil
		},
	}
	cmd.Flags().IntVarP(&steps, "steps", "n", 1, "number of steps to roll back")
	return cmd
}

func migrateVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Show current migration version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := newMigrator()
			if err != nil {
				return err
			}
			defer m.Close()

			v, dirty, err := m.Version()
			if err != nil {
				return fmt.Errorf("get version: %w", err)
			}
			cmd.Printf("version: %d, dirty: %v\n", v, dirty)
			return nil
		},
	}
}

func migrateForceCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "force <version>",
		Short: "Force the recorded version without running a migration (recovery only)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			version, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid version: %w", err)
			}
			m, err := newMigrator()
			if err != nil {
				return err
			}
			defer m.Close()

			if err := m.Force(version); err != nil {
				return fmt.Errorf("force version: %w", err)
			}
			slog.Info("forced migration version", "version", version)
			return nil
		},
	}
}
