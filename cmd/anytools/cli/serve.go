package cli

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/D0bby999/anytools/internal/app"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/logging"
)

func serveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Run the AnyTools API server",
		Long: "Runs the API. Migrations are NEVER applied here — run `anytools migrate up`\n" +
			"as a separate step so a deploy cannot half-apply a schema change while\n" +
			"serving traffic.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			// Every line passes the redacting handler: a provider error that quotes
			// the request's key back must not land in the log (phase 11).
			slog.SetDefault(slog.New(logging.NewRedactingHandler(
				slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))))
			config.WarnLegacyEnv(slog.Default())

			cfg, err := config.Load()
			if err != nil {
				return err
			}

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			application, err := app.Build(ctx, cfg)
			if err != nil {
				return err
			}
			defer application.Close()

			srv := &http.Server{
				Addr:              cfg.Server.Addr,
				Handler:           application.Handler,
				ReadHeaderTimeout: 10 * time.Second,
				IdleTimeout:       120 * time.Second,
				// No WriteTimeout: phase 5 adds a long-lived SSE stream on this
				// same server, and a write deadline would sever it mid-answer.
				// Request lifetime is bounded by context instead.
			}

			errCh := make(chan error, 1)
			go func() {
				slog.Info("api listening", "addr", cfg.Server.Addr)
				if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					errCh <- err
				}
			}()

			select {
			case err := <-errCh:
				return err
			case <-ctx.Done():
				slog.Info("shutdown signal received")
			}

			shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			return srv.Shutdown(shutdownCtx)
		},
	}
}
