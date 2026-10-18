VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  = -s -w -X github.com/D0bby999/anytools/cmd/anytools/cli.Version=$(VERSION)
BINARY   = anytools

# Default test DSN. CI overrides it to point at the service container; there,
# an unreachable database FAILS the suite instead of skipping it.
ANYTOOLS_TEST_DSN ?= postgres://localhost:5432/anytools_test?sslmode=disable
export ANYTOOLS_TEST_DSN

.PHONY: build run clean version test test-db vet fmt web-install web-typecheck web-build web-test dev migrate setup ci notices

build:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o $(BINARY) ./cmd/anytools

run: build
	./$(BINARY) serve

clean:
	rm -f $(BINARY)
	rm -rf ui/web/build ui/web/.react-router

version:
	@echo $(VERSION)

fmt:
	gofmt -w cmd internal scripts

vet:
	go vet ./...

test:
	go test -race ./...

# Creates the test database and applies migrations to it. Run once before
# `make test` on a fresh machine.
test-db:
	@createdb anytools_test 2>/dev/null || true
	@ANYTOOLS_POSTGRES_DSN="$(ANYTOOLS_TEST_DSN)" go run ./cmd/anytools migrate up

web-install:
	cd ui/web && pnpm install --frozen-lockfile

web-typecheck:
	cd ui/web && pnpm typecheck

web-build:
	cd ui/web && pnpm build

web-test:
	cd ui/web && pnpm test

dev:
	cd ui/web && pnpm dev

migrate:
	go run ./cmd/anytools migrate up

setup: web-install
	go mod download

# The gate CI runs and the one to run before pushing.
ci: vet test web-typecheck web-build web-test

# Rewrites THIRD-PARTY-NOTICES.md from go.mod, ui/web's production install and
# scripts/notices/adapted.md. Run after adding or upgrading a dependency.
notices: web-install
	go run ./scripts/notices
