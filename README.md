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
