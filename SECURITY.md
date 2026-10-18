# Security policy

AnyTools takes uploads from anyone, reads them with language models and stores other people's API keys, so a security report is the most useful kind of report it can get.

## Reporting a vulnerability

Report it **privately**, through GitHub's security advisories: on the repository, open **Security → Report a vulnerability** (<https://github.com/D0bby999/anytools/security/advisories/new>). Please do not open a public issue, pull request or discussion about it.

A useful report says:

- what an attacker can do, and what they need first (an account, a crafted file, a page the app fetches);
- the steps to reproduce it, against a local instance (`deploy/scripts/run-local.sh`);
- the commit or image tag you tested.

You will get an acknowledgement within a week. Once a fix is released, the advisory is published with credit to you, unless you would rather stay anonymous.

## Scope

In scope: this repository's code, its Docker images (`ghcr.io/d0bby999/anytools-api` and `-web`) and the deployment files under `deploy/`. Examples:

- reading or changing another user's data;
- reaching the API from outside the compose network, or calling it as another user;
- recovering a stored API key;
- prompt injection that makes the app act beyond the learner's request (fetching, writing or revealing something);
- script execution through rendered model output or an uploaded file.

Out of scope: the third-party AI providers themselves, denial of service by volume, and reports from automated scanners with no demonstrated impact.

Please test only against your own instance, never against anytools.world or other people's accounts.

## Supported versions

Only the latest commit on `main`, and the images built from it, receive fixes.

## Accepted advisories

- **GHSA-hp3w-g68c-fv3c (`sprintf-js`, moderate).** It is ignored in `ui/web/package.json` (`pnpm.auditConfig`). `sprintf-js` arrives only through `mammoth > argparse`, which mammoth uses for its command line; the docx tool loads `mammoth.browser.js`, which references neither. No patched version exists. Re-check when mammoth upgrades.
