# Usage

## What the tool does

The project now exposes a local CLI that reads a JSON file of context chunks and produces one of two outputs:

- a filtered context window
- a teaching-oriented packet built on top of that filtered window
- a generated learning README for humans
- a memory recall flow backed by Engram
- a durable memory write flow backed by Engram

## Why a CLI matters

Before this, the project was only a library. That is not enough for a serious repo because another person cannot evaluate the system quickly.

With the CLI, the workflow becomes:

1. collect chunks
2. save them in JSON
3. run the selector
4. inspect the chosen context
5. run the teaching packet builder
6. generate a README that tells a teammate what to learn first
7. recall recent or historical memory from Engram
8. save durable learnings back into Engram

You can now skip manual JSON for many tasks by using `--workspace .`, which scans the repository and builds chunks from local files automatically.

## Current playground surface

There is no separate `playground/` UI yet. The current playground is the CLI itself.

That playground has two deliberate modes:

1. **Synthetic playground**
   - uses `examples/auth-context.json`
   - demonstrates ranking, suppression, and teaching output deterministically
   - disables Engram recall on purpose so the auth demo does not pretend to have historical memory
2. **Memory-backed playground**
   - scans the real workspace with `--workspace .`
   - recalls real Engram memories from this repository
   - demonstrates how local code context and durable memory interact

Recommended scripts:

- `cmd /c npm.cmd run playground:select`
- `cmd /c npm.cmd run playground:select:debug`
- `cmd /c npm.cmd run playground:teach:synthetic`
- `cmd /c npm.cmd run playground:teach:memory`
- `cmd /c npm.cmd run playground:teach:memory:debug`
- `cmd /c npm.cmd run playground:readme`
- `cmd /c npm.cmd run playground:recall`
- `cmd /c npm.cmd run playground:recall:debug`
- `cmd /c npm.cmd run vertical:ts:teach`
- `cmd /c npm.cmd run vertical:ts:teach:memory`
- `cmd /c npm.cmd run vertical:ts:readme`

If PowerShell blocks `npm.ps1`, use `cmd /c npm.cmd run ...` or call the raw `node src/cli.js ...` commands shown below.

## Debug mode

Use `--debug` when you want the playground to explain its decisions instead of only showing the final result.

The debug view currently exposes:

- score signals for selected chunks
- origin of each chunk (`workspace` vs `engram`)
- suppression reasons and counts
- recovered memory ids
- which recalled memories were selected versus suppressed

## Command 1: Select useful context in the synthetic playground

```bash
node src/cli.js select --input examples/auth-context.json --focus "jwt middleware expired session validation" --min-score 0.25 --format text
```

What happens internally:

1. the CLI parses command-line options
2. it loads and validates the JSON input
3. it calls the context selector
4. it returns selected chunks and suppressed chunks

## Command 2: Build a learning packet from synthetic example data

```bash
node src/cli.js teach --input examples/auth-context.json --task "Improve auth middleware" --objective "Teach why validation runs before route handlers" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project learning-context-system --no-recall --min-score 0.25 --format text
```

What happens internally:

1. the CLI parses command-line options
2. it loads the same chunk file
3. it skips Engram recall because this demo is intentionally synthetic
4. it calls the mentor loop
5. the mentor loop first calls the context selector
6. it then adds teaching scaffolding on top of the selected context

This is the safest place to evaluate the teaching loop itself because the output does not depend on previously saved project memory.

## Command 3: Build a learning packet with real workspace memory

```bash
node src/cli.js teach --workspace . --task "Summarize teach recall architecture" --objective "Teach how Engram recall is injected into teach" --changed-files "src/memory/teach-recall.js,src/cli/app.js" --project learning-context-system --recall-query "teach recall" --token-budget 520 --max-chunks 8 --min-score 0.25 --format text
```

What happens internally:

1. the CLI scans the workspace into chunks
2. it recalls Engram memory for a query that is known to exist in this repository
3. it merges recalled memory chunks with the workspace chunks
4. it calls the mentor loop
5. it reports both recalled memory diagnostics and the final selected context
6. it now separates the result into `Código principal`, `Test relacionado`, `Memoria histórica útil`, and `Contexto de soporte`

Use this mode when you want to debug the interaction between current code, recall heuristics, and the final teaching packet.

If you want the extra diagnostics inline, rerun the same command with `--debug`.

## Command 4: Generate a learning README

```bash
node src/cli.js readme --workspace . --focus "learning context cli noise cancellation" --output README.LEARN.md --format text
```

What happens internally:

1. the CLI scans the workspace into chunks
2. it selects the most relevant context for the requested focus
3. it inspects project metadata and imports
4. it infers which concepts are required to understand the code
5. it writes a markdown guide that lists dependencies, concepts, reading order, and data flow

## TypeScript backend vertical

There is now a realistic mini-workspace at `examples/typescript-backend`.

Use it when you want a reproducible backend scenario with:

- TypeScript middleware
- route handler
- related test
- ADR/spec
- logs and stale chat noise

Deterministic mode:

```bash
node src/cli.js teach --workspace examples/typescript-backend --task "Harden auth middleware" --objective "Teach request-boundary validation in a TypeScript server" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project typescript-backend-vertical --no-recall --format text
```

Memory-backed mode:

```bash
node scripts/seed-typescript-vertical-memory.js
node src/cli.js teach --workspace examples/typescript-backend --task "Harden auth middleware" --objective "Teach request-boundary validation in a TypeScript server" --changed-files "src/auth/middleware.ts,test/auth/middleware.test.ts" --project typescript-backend-vertical --recall-query "auth validation order" --token-budget 520 --max-chunks 6 --format text
```

## Command 5: Recall memory from Engram

```bash
node src/cli.js recall --project learning-context-system --query "teach recall" --scope project --limit 5 --format text
```

What happens internally:

1. the CLI decides whether you want recent context or a historical search
2. it creates an Engram client pointed at the local binary and data directory
3. it runs `engram search` when you provide `--query`
4. it runs `engram context` when you omit `--query`
5. it returns the raw Engram memory wrapped in a clearer CLI summary

## Command 6: Save a durable memory into Engram

```bash
node src/cli.js remember --title "JWT order" --content "Validation runs before route handlers." --project learning-context-system --type decision --topic architecture/auth-order --format text
```

What happens internally:

1. the CLI validates that you provided a title and content
2. it creates an Engram client
3. it runs `engram save`
4. Engram persists the observation in SQLite
5. the CLI prints what was saved and where the database lives

## Command 7: Close the work session with a structured note

```bash
node src/cli.js close --summary "Integrated recall and remember commands." --learned "Context retrieval and durable memory are different layers." --next "Connect recall to the teaching flow." --project learning-context-system --format text
```

What happens internally:

1. the CLI builds a structured summary note
2. it includes the summary, what you learned, what comes next, and the workspace path
3. it saves that note through Engram
4. this is a practical session-close note, not the full MCP session lifecycle yet

## Automatic memory recall during teach

By default, `teach` now does a best-effort recall from Engram.

That default is useful for real workspace flows, but the synthetic auth playground should usually opt out with `--no-recall`.

It no longer depends on one raw sentence only. The CLI first derives shorter concept-heavy queries such as:

- architecture terms from changed files
- noun-like variants such as `validation` from `validate` or `integration` from `integrate`
- compressed keyword groups instead of the whole task sentence

Useful options:

- `--project`: narrows recall to one Engram project
- `--recall-query`: overrides the query used for memory search
- `--memory-limit`: caps how many memories are imported as chunks
- `--memory-type`: filters recall by Engram memory type
- `--memory-scope`: defaults to `project`
- `--no-recall`: disables the feature
- `--strict-recall`: fails the command if Engram recall fails instead of continuing without memory
- `--debug`: prints ranking signals, suppression breakdown, and recall internals for inspection

## Input contract

The JSON file must look like this:

```json
{
  "chunks": [
    {
      "id": "auth-middleware",
      "source": "src/auth/middleware.ts",
      "kind": "code",
      "content": "The authentication middleware validates the bearer token first."
    }
  ]
}
```

Optional numeric fields:

- `certainty`
- `recency`
- `teachingValue`
- `priority`

All optional numeric fields must be between `0` and `1`.

Useful CLI thresholds:

- `--min-score`: drops weak matches before they consume prompt budget
- `--max-chunks`: caps how many chunks survive
- `--sentence-budget`: compresses long chunks more aggressively

Input source options:

- `--input`: load chunks from a prepared JSON file
- `--workspace`: scan the repository directly and build chunks automatically

Advanced Engram options:

- `--engram-bin`: override the local path to `engram.exe`
- `--engram-data-dir`: override the Engram data directory
