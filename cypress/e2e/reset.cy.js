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
    const toggleSelector = `[data-cy=file-structure-toggle][data-path="${parent}"]`
    cy.get(toggleSelector).then(($toggle) => {
      const label = $toggle.attr('aria-label') || ''
      if (label.startsWith('Expand')) {
        cy.wrap($toggle).click()
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

const editFile = (path, line) => {
  openEditorFile(path)
  cy.get('[data-cy=editor-textarea]')
    .scrollIntoView()
    .click({ force: true })
    .type(`{moveToEnd}{enter}${line}`, { force: true })
}

describe('reset workflows', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
    runCommand('git checkout main')
  })

  it('supports soft, mixed, and hard reset', () => {
    editFile('/src/index.txt', 'Soft reset line')
    runCommand('git add /src/index.txt')
    runCommand('git commit -m "reset base"')
    editFile('/src/index.txt', 'Soft reset change')
    runCommand('git add /src/index.txt')
    runCommand('git commit -m "reset head"')

    runCommand('git reset --soft HEAD~1')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'Changes to be committed')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- src/index.txt')

    runCommand('git reset --mixed HEAD')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'Changes not staged for commit')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'diff -- src/index.txt')

    runCommand('git reset --hard HEAD')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'nothing to commit')
  })

  it('unstages files with reset HEAD <file>', () => {
    editFile('/docs/setup.txt', 'Reset file line')
    runCommand('git add /docs/setup.txt')
    runCommand('git reset HEAD /docs/setup.txt')
    runCommand('clear')
    runCommand('git diff --staged')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'docs/setup.txt')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'Changes not staged for commit')
  })

  it('moves HEAD to a commit with reset --hard', () => {
    editFile('/docs/overview.txt', 'Reset hard line')
    runCommand('git add /docs/overview.txt')
    runCommand('git commit -m "hard reset change"')
    runCommand('clear')
    runCommand('git log --oneline -n 2')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .then((line) => {
        const sha = line.trim().split(' ')[0]
        runCommand(`git reset --hard ${sha}`)
        runCommand('clear')
        runCommand('git log --oneline -n 1')
        cy.get('[data-cy=terminal-body]').should('contain', sha)
      })
  })

  it('resets to a commitish ref and keeps branch checked out', () => {
    editFile('/docs/overview.txt', 'Commitish line A')
    runCommand('git add /docs/overview.txt')
    runCommand('git commit -m "commitish A"')
    editFile('/docs/overview.txt', 'Commitish line B')
    runCommand('git add /docs/overview.txt')
    runCommand('git commit -m "commitish B"')
    runCommand('git reset --hard HEAD~1')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'On branch main')
    openEditorFile('/docs/overview.txt')
    cy.get('[data-cy=editor-textarea]').should('contain.text', 'Commitish line A')
  })

  it('resets to a remote ref', () => {
    runCommand('git fetch origin')
    runCommand('git reset --hard origin/main')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'On branch main')
  })
})
