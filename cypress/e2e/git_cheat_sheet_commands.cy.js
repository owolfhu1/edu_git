const runCommand = (command) => {
  cy.get('[data-cy=terminal-input]').type(`${command}{enter}`)
}

const openMockEnvironment = () => {
  cy.get('[data-cy=workspace-menu-toggle]').click()
  cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
  cy.get('[data-cy=workspace-menu-mock]').click()
  cy.get('[data-cy=file-structure-folder][data-path="/docs"]', {
    timeout: 20000,
  }).should('exist')
}

const ensurePathVisible = (path) => {
  const parts = path.split('/').filter(Boolean)
  const parents = parts.slice(0, -1).map((_, index) => `/${parts.slice(0, index + 1).join('/')}`)
  parents.forEach((parent) => {
    cy.get('body').then(($body) => {
      const fileSelector = `[data-cy=file-structure-file][data-path="${path}"]`
      const toggleSelector = `[data-cy=file-structure-toggle][data-path="${parent}"]`
      if ($body.find(fileSelector).length === 0 && $body.find(toggleSelector).length > 0) {
        cy.get(toggleSelector).click()
      }
    })
  })
}

const openEditorFile = (path) => {
  ensurePathVisible(path)
  cy.get(`[data-cy=file-structure-file][data-path="${path}"]`)
    .find('[data-cy=file-structure-open]')
    .click()
  cy.get(`[data-cy=editor-tab][data-path="${path}"]`).should('exist')
}

const readOutputLines = () =>
  cy
    .get('[data-cy=terminal-line][data-line-type="output"]')
    .then(($lines) =>
      [...$lines]
        .map((line) => line.textContent.trim())
        .filter(Boolean)
    )

describe('git cheat sheet commands', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('handles diff, restore, checkout --, and reset staging flows', () => {
    runCommand('git checkout main')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Diff coverage line')

    runCommand('clear')
    runCommand('git diff')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- src/index.txt')

    runCommand('git add /src/index.txt')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- src/index.txt')

    runCommand('git restore --staged /src/index.txt')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'diff -- src/index.txt')

    runCommand('git add /src/index.txt')
    runCommand('git reset HEAD /src/index.txt')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'diff -- src/index.txt')

    runCommand('git restore /src/index.txt')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'nothing to commit, working tree clean'
    )

    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Checkout restore line')

    runCommand('git checkout -- /src/index.txt')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'nothing to commit, working tree clean'
    )
  })

  it('covers branch listing, switching, checkout, merge, and rebase', () => {
    runCommand('git fetch origin')
    runCommand('clear')
    runCommand('git branch -r')
    cy.get('[data-cy=terminal-body]').should('contain', 'remotes/origin/main')

    runCommand('clear')
    runCommand('git branch -a')
    cy.get('[data-cy=terminal-body]').should('contain', 'remotes/origin/main')
    cy.get('[data-cy=terminal-body]').should('contain', 'main')

    runCommand('git switch -c switch_branch')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'On branch switch_branch')

    runCommand('git switch main')
    runCommand('git branch -d switch_branch')
    runCommand('clear')
    runCommand('git branch')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'switch_branch')

    runCommand('git checkout -b feature_merge')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Feature merge line')
    runCommand('git add /src/index.txt')
    runCommand('git commit -m "feature merge change"')

    runCommand('git checkout main')
    runCommand('git merge feature_merge')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'Merged feature_merge into main'
    )
    runCommand('clear')
    runCommand('git log')
    cy.get('[data-cy=terminal-body]').should('contain', 'feature merge change')
    runCommand('clear')
    runCommand('git log --oneline -n 1')
    cy.get('[data-cy=terminal-body]').should('contain', 'feature merge change')

    runCommand('clear')
    runCommand('git rev-parse HEAD')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .should('match', /^[0-9a-f]{40}$/i)
    runCommand('clear')
    runCommand('git rev-parse --short HEAD')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .should('match', /^[0-9a-f]{7}$/i)

    runCommand('git checkout HEAD~1')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'HEAD detached at')
    runCommand('git checkout main')

    runCommand('git checkout HEAD^')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'HEAD detached at')
    runCommand('git checkout main')

    runCommand('clear')
    runCommand('git log --oneline -n 2')
    readOutputLines().then((lines) => {
      const targetLine = lines[1]
      const sha = targetLine.split(' ')[0]
      runCommand(`git checkout ${sha}`)
      runCommand('clear')
      runCommand('git status')
      cy.get('[data-cy=terminal-body]').should('contain', 'HEAD detached at')
      runCommand('git checkout main')
    })

    runCommand('git checkout -b rebase_branch')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Rebase line')
    runCommand('git add /src/index.txt')
    runCommand('git commit -m "rebase change"')
    runCommand('git checkout main')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Main line for rebase')
    runCommand('git add /src/index.txt')
    runCommand('git commit -m "main rebase base"')
    runCommand('git checkout rebase_branch')
    runCommand('git rebase main')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'Automatic rebase failed; fix conflicts and run "git rebase --continue".'
    )
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{selectall}{backspace}Rebase resolved line{enter}', { force: true })
    runCommand('git add /src/index.txt')
    runCommand('git rebase --continue')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'Successfully rebased and updated rebase_branch.'
    )
  })

  it('covers file ops, reset --hard, and remote merge', () => {
    runCommand('git checkout main')
    runCommand('touch /docs/ops.txt')
    openEditorFile('/docs/ops.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('Ops file content')
    runCommand('git add /docs/ops.txt')
    runCommand('git commit -m "add ops file"')

    runCommand('git mv /docs/ops.txt /docs/ops_renamed.txt')
    runCommand('git add /docs/ops_renamed.txt')
    runCommand('git commit -m "rename ops file"')

    runCommand('git rm /docs/ops_renamed.txt')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- docs/ops_renamed.txt')

    runCommand('clear')
    runCommand('git log --oneline -n 2')
    readOutputLines().then((lines) => {
      const targetLine = lines[1]
      const sha = targetLine.split(' ')[0]
      runCommand(`git reset --hard ${sha}`)
      runCommand('clear')
      runCommand('git log --oneline -n 1')
      cy.get('[data-cy=terminal-body]').should('contain', sha)
    })

    runCommand('git remote -v')
    cy.get('[data-cy=terminal-body]').should('contain', 'origin')
    runCommand('git fetch origin')
    cy.get('[data-cy=terminal-body]').should('contain', 'Fetched origin')
    runCommand('git pull origin main')
    cy.get('[data-cy=terminal-body]').should('contain', 'origin')
    runCommand('git merge origin/collaborator_branch')
    cy.get('[data-cy=terminal-body]').should(($body) => {
      expect($body.text()).to.match(
        /Merged origin\/collaborator_branch into main|Already up to date\./
      )
    })
  })
})
