# Edu Git

Edu Git is a browser-based Git education playground that mimics a lightweight IDE.
Learners can create and edit text files, navigate a file tree, and run terminal-style
commands against a real Git engine in the browser. It includes a simulated remote repo
UI with branches, commits, compare, and merge request flows, plus workspace presets to
spin up example projects.

## Stack

- React + Vite
- lightning-fs (virtual filesystem for the browser)
- isomorphic-git (real Git behavior in the browser)
- Vitest + Cypress (unit + E2E testing)

## Highlights

- Virtual filesystem with folders and .txt files (create, rename, delete)
- File editor with tabs, gutter highlighting, and diff controls
- Terminal with core shell commands and a growing set of Git commands
- Remote Repo UI with a home page, repo browser, and MR workflows (compare, merge)
- Remote actions like clone/fork/delete for simulated repositories

## File System Model

Edu Git runs a sandboxed filesystem in the browser. The local workspace uses `/` as the root,
and you can create folders/files (including `.gitignore`) with the UI or terminal. Git metadata
is stored under `/.git` just like a real repo, and the file tree intentionally hides `.git`.

Remote repositories live under `/.remotes/<repo-name>`. The Remote Repo UI presents those
folders as hosted repos at `https://remote.mock/<repo-name>` and reads their own `/.git`
state independently. Commands like `git clone https://remote.mock/<repo>` copy the remote
repo contents into the local workspace.

## Git Engine

Edu Git uses `isomorphic-git` to execute real Git operations inside the browser against the
virtual filesystem. This keeps command output and behavior close to real Git while letting
us intercept and extend flows (conflicts, simulated remotes, MR metadata) for education.
Where the browser environment differs, we surface the differences in UI or command output
so learners still build accurate muscle memory.

## CLI Wrapper

The terminal is a lightweight command dispatcher over the in-browser filesystem. Input is
parsed in `TerminalPane.jsx` and routed through `src/terminal/commands/index.js`, which
combines core shell commands (`ls`, `cd`, `cat`, `touch`, `mkdir`, `rm`, `echo`) with a
`git` handler. The Git handler (`src/terminal/commands/git.js`) finds the repo root, maps
arguments to `isomorphic-git` calls, and formats output to match real Git. The context
object passed to commands includes the current working directory, filesystem helpers, and
UI hooks to refresh the tree and terminal output.

## Development

```sh
yarn
yarn dev
```

## Testing

The deploy workflow runs unit tests and Cypress E2E tests before building GitHub Pages.

Run locally:

```sh
yarn test:run
yarn e2e
```

Watch in the Cypress UI:

```sh
yarn e2e:open
```
