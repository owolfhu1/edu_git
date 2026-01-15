const runCommand = (command) => {
  cy.get('[data-cy=terminal-input]').type(`${command}{enter}`)
}

describe('edu-git terminal workflows', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('shows the terminal welcome message', () => {
    cy.get('[data-cy=terminal]').should('be.visible')
    cy.get('[data-cy=terminal-line]').first().should('contain', 'Welcome to edu-git terminal.')
  })

  it('loads the mock full environment and runs git status', () => {
    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-mock]').click()
    cy.get('[data-cy=file-structure-folder][data-path="/docs"]', {
      timeout: 20000,
    }).should('exist')

    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should('contain', 'On branch')
  })
})
