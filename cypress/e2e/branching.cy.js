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
  cy.get('[data-cy=file-structure-file][data-path="/src/index.txt"]', {
    timeout: 20000,
  }).should('exist')
}

const openEditorFile = (path) => {
  cy.get(`[data-cy=file-structure-file][data-path="${path}"]`)
    .find('[data-cy=file-structure-open]')
    .click()
  cy.get(`[data-cy=editor-tab][data-path="${path}"]`).should('exist')
}

describe('branching workflows', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('creates a feature branch, commits, and shows branch-specific content', () => {
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .invoke('text')
      .then((text) => {
        cy.wrap(text).as('mainContent')
      })

    runCommand('git checkout -b feature_branch')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]', { timeout: 10000 }).should(
      'contain',
      'On branch feature_branch'
    )

    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type('{moveToEnd}{enter}Feature branch note')

    runCommand('git add /src/index.txt')
    runCommand('git commit -m "feature change"')
    runCommand('git log --oneline -n 1')
    cy.get('[data-cy=terminal-body]').should('contain', 'feature change')

    runCommand('git checkout main')
    cy.get('[data-cy=editor-tab][data-path="/src/index.txt"]').should('exist')
    cy.get('@mainContent').then((mainContent) => {
      cy.get('[data-cy=editor-textarea]', { timeout: 10000 }).should(
        'have.text',
        mainContent
      )
    })

    runCommand('git checkout feature_branch')
    cy.get('[data-cy=editor-tab][data-path="/src/index.txt"]').should('exist')
    cy.get('[data-cy=editor-textarea]', { timeout: 10000 }).should(
      'contain',
      'Feature branch note'
    )
  })

  it('deletes a branch after switching back to main', () => {
    runCommand('git checkout -b cleanup_branch')
    runCommand('git checkout main')
    runCommand('git branch -D cleanup_branch')
    runCommand('clear')
    runCommand('git branch')
    cy.get('[data-cy=terminal-body]').should('contain', 'main')
    cy.get('[data-cy=terminal-body]').should('not.contain', 'cleanup_branch')
  })
})
