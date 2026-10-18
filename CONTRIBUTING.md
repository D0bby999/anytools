# Contributing to AnyTools

Thank you for helping. Issues and pull requests are both welcome; for a large change, open an issue first so the approach can be agreed before you write it.

## Set up

Follow the README's quick start: Go (the version `go.mod` pins), Node 22 with pnpm 10, and PostgreSQL 16 with pgvector on localhost.

```sh
deploy/scripts/run-local.sh --init   # once
make setup test-db                   # dependencies, and the anytools_test database
```

## The checks a pull request must pass

CI runs these on every pull request (`.github/workflows/test.yml`), and they are quick to run first:

```sh
gofmt -l cmd internal scripts        # prints nothing
go vet ./...
make test                            # go test -race ./... against a real Postgres
make web-typecheck web-test web-build
```

CI also runs `govulncheck`, `pnpm audit --prod` and gitleaks. A database test never skips in CI: if one cannot reach Postgres, it fails.

After adding or upgrading a dependency, run `make notices` and commit the new `THIRD-PARTY-NOTICES.md`; a test fails when it is stale.

## Rules the code keeps

These are tested, and a pull request that breaks one will fail:

- **Every row belongs to a user.** Every table has `user_id`, and every id a request names is resolved with the caller's id. Another user's id answers exactly like a missing one (404). A new route gets an entry in the isolation harness, `internal/app/isolation_test.go`.
- **No platform keys.** Every model, search or transcription call uses the learner's own connection through `internal/byok`. The server holds no AI credential.
- **Untrusted input stays data.** Text from documents, pages, transcripts or learners is wrapped with `tools.Wrap` before it reaches a model, and model output is rendered through the sanitising renderers, never as raw HTML.
- **Every write route declares its budget** with a `// budget: <class>` comment on its registration line.
- **Migrations are timestamp-named**, each with an `.up.sql` and a `.down.sql`.
- **The UI uses the design tokens** in `ui/web/DESIGN.md`: no colour literals in `.tsx`, and no one-sided accent borders. App strings live in the locale JSON files; the public tool pages carry English, Vietnamese, Spanish and Portuguese.

Match the code around your change: its naming, its comment density and its idiom. `internal/capabilities/quiz` with `internal/api/quizapi` is a good model for a new feature.

## Commits

Small commits with conventional messages (`feat(quiz): …`, `fix(api): …`, `docs: …`). A bug fix comes with a test that fails without it.

## Licence

By contributing, you agree that your contribution is licensed under the MIT licence in [LICENSE](LICENSE). Do not paste code whose licence conflicts with MIT (GPL code, for example); when you adapt MIT, BSD or Apache code, add its notice to `scripts/notices/adapted.md` and run `make notices`.

## Security problems

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
