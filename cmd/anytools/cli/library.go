package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/D0bby999/anytools/internal/library"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// libraryCmd loads the Library's catalogue by hand. The server loads it as
// it starts when the version differs; this is for a load that failed, or
// with --force for one that must be redone.
func libraryCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "library", Short: "The Library's catalogue of ready material"}
	var force bool
	importCmd := &cobra.Command{
		Use:   "import",
		Short: "Load the catalogue built into this binary into the database",
		RunE: func(cmd *cobra.Command, _ []string) error {
			dsn, err := resolveDSN()
			if err != nil {
				return err
			}
			pool, err := pg.Open(cmd.Context(), dsn)
			if err != nil {
				return err
			}
			defer pool.Close()
			loaded, err := library.NewService(pg.NewLibraryStore(pool)).Sync(cmd.Context(), force)
			if err != nil {
				return err
			}
			c, _ := library.Embedded()
			if loaded {
				fmt.Fprintf(cmd.OutOrStdout(), "loaded %d items from %d sources (version %s, sequence %d)\n", len(c.Items), len(c.Sources), c.Version[:12], c.Sequence)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "not loaded: this version or a later one is in the database (this is %s, sequence %d; --force loads it anyway)\n", c.Version[:12], c.Sequence)
			}
			return nil
		},
	}
	importCmd.Flags().BoolVar(&force, "force", false, "load even when the stored version is the same")
	cmd.AddCommand(importCmd)
	return cmd
}
