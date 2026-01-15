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

const assertConflictMarkers = () => {
  cy.get('[data-cy=editor-textarea]').should('contain.text', '<<<<<<<')
  cy.get('[data-cy=editor-textarea]').should('contain.text', '=======')
  cy.get('[data-cy=editor-textarea]').should('contain.text', '>>>>>>>')
}

describe('stash workflows', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('stashes tracked changes and applies them', () => {
    editFile('/src/index.txt', 'Stash apply line')
    runCommand('git stash -m "apply test"')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'nothing to commit')

    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash@{0}')
    cy.get('[data-cy=terminal-body]').should('contain', 'apply test')

    runCommand('git stash apply')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]').should('contain.text', 'Stash apply line')
  })

  it('stashes untracked files by default and restores them', () => {
    runCommand('touch /docs/stash_note.txt')
    runCommand('git stash -m "untracked"')
    runCommand('clear')
    runCommand('ls /docs')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'stash_note.txt')

    runCommand('git stash pop')
    runCommand('clear')
    runCommand('ls /docs')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash_note.txt')
  })

  it('pops a stash and removes it from the list', () => {
    editFile('/docs/setup.txt', 'Pop stash line')
    runCommand('git stash -m "pop me"')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash@{0}')

    runCommand('git stash pop')
    runCommand('clear')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'stash@{0}')
    openEditorFile('/docs/setup.txt')
    cy.get('[data-cy=editor-textarea]').should('contain.text', 'Pop stash line')
  })

  it('applies a specific stash by index', () => {
    runCommand('git stash clear')
    editFile('/docs/overview.txt', 'First stash line')
    runCommand('git stash -m "first"')
    editFile('/docs/setup.txt', 'Second stash line')
    runCommand('git stash -m "second"')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash@{0}')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash@{1}')

    runCommand('git stash apply stash@{{}1{}}')
    cy.get('[data-cy=terminal-body]').should('contain', 'Applied stash.')
    openEditorFile('/docs/overview.txt')
    cy.get('[data-cy=editor-textarea]').should('contain.text', 'First stash line')
  })

  it('reports conflicts when applying a stash', () => {
    editFile('/docs/overview.txt', 'Stash conflict line')
    runCommand('git stash -m "conflict"')
    editFile('/docs/overview.txt', 'Current conflict line')
    runCommand('git stash apply')
    openEditorFile('/docs/overview.txt')
    assertConflictMarkers()
  })

  it('drops and clears stashes', () => {
    editFile('/docs/overview.txt', 'Stash drop line')
    runCommand('git stash -m "drop me"')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('contain', 'stash@{0}')

    runCommand('git stash drop stash@{0}')
    runCommand('clear')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'stash@{0}')

    editFile('/docs/setup.txt', 'Clear stash line')
    runCommand('git stash -m "clear me"')
    runCommand('git stash clear')
    runCommand('git stash list')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'stash@{0}')
  })
})
