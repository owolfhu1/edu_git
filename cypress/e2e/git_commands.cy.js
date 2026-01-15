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

describe('git command basics', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('shows git status and switches branches', () => {
    runCommand('git status')
    cy.get('[data-cy=terminal-body]', { timeout: 10000 }).should(
      'contain',
      'On branch test_branch'
    )

    runCommand('git branch')
    cy.get('[data-cy=terminal-body]').should('contain', 'main')

    runCommand('git checkout test_branch')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'On branch test_branch')

    runCommand('git checkout main')
    runCommand('git log --oneline -n 1')
    cy.get('[data-cy=terminal-body]').should('contain', 'init commit')
  })
})
