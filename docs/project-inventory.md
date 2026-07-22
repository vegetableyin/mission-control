# Local project inventory

Mission Control can register local projects, discover import candidates, and collect read-only Git metadata. Discovery never imports candidates automatically. A user must explicitly confirm each import.

## Configuration

```dotenv
MC_PROJECT_SCAN_ROOTS=D:\Work
MC_PROJECT_SCAN_MAX_DEPTH=2
MC_PROJECT_SCAN_TIMEOUT_MS=30000
MC_GIT_COMMAND_TIMEOUT_MS=5000
MC_DEFAULT_STALE_DAYS=7
```

On Windows, separate multiple roots with `;`. On Linux and macOS, use `:`. When `MC_PROJECT_SCAN_ROOTS` is omitted on Windows, Mission Control derives the `Work` directory from the current drive instead of embedding a user profile path.

## Safety boundary

- Discovery uses directory enumeration, metadata checks, and `realpath` validation only.
- Hidden directories, symlinks, dependencies, build outputs, backups, logs, and temporary directories are skipped.
- Candidate files are identified by filename; source contents, `.env`, credentials, and `auth.json` are not read.
- Registered paths must resolve inside an allowed root. Lexical traversal and symlink escapes are rejected.
- Scans never write to project directories and never execute project scripts, package managers, Docker, Python, or tests.
- Git collection uses only `status --porcelain`, `branch --show-current`, `rev-parse`, `log`, `remote get-url`, and `rev-list` with a fixed working directory and timeout.
- Ahead and behind counts use existing local tracking references. Mission Control never performs `fetch`, `pull`, `checkout`, `commit`, `push`, `reset`, or `clean`.

## Health scoring

Health starts at 100 and records every deduction. Manual `blocked` status and missing directories take precedence. Completed, paused, and archived projects do not receive inactivity or old-commit deductions. The first version is deterministic and does not call an AI model.

Scanning is manual in this phase. Service functions and APIs support one-project and all-project scans, but no scheduler or Windows task is created.
