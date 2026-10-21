// Package cli holds the cobra command tree for the anytools binary.
package cli

import (
	"os"

	"github.com/spf13/cobra"
)

// Version is set at build time via
// -ldflags "-X github.com/D0bby999/anytools/cmd/anytools/cli.Version=v1.0.0".
var Version = "dev"

var rootCmd = &cobra.Command{
	Use:   "anytools",
	Short: "AnyTools — self-learning platform API",
	Long: "AnyTools: a self-learning platform that grounds chat, quizzes and mastery paths\n" +
		"in the user's own documents, using the user's own AI accounts.",
	SilenceUsage: true,
}

func init() {
	rootCmd.AddCommand(versionCmd(), serveCmd(), migrateCmd(), verifyCmd(), libraryCmd())
}

// Execute runs the root command.
//
// .env.local is loaded first so a developer can keep secrets in a file without
// exporting them; it never overrides an already-set variable, so the compose
// and CI environments always win over a stray local file.
func Execute() {
	loadEnvFile(".env.local")
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(cmd *cobra.Command, _ []string) {
			cmd.Printf("anytools %s\n", Version)
		},
	}
}
