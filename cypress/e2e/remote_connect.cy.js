const runCommand = (command) => {
  cy.get('[data-cy=terminal-input]').type(`${command}{enter}`)
}

const waitForDefaultEnvironment = () => {
  cy.get('[data-cy=file-structure-file][data-path="/src/README.txt"]', {
    timeout: 20000,
  }).should('exist')
}

describe('remote connection flow', () => {
  beforeEach(() => {
    cy.visit('/')
    waitForDefaultEnvironment()
  })

  it('connects the default repo to remote', () => {
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'fatal: not a git repository'
    )

    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-remote]').click()

    cy.get('[data-cy=remote-modal]').should('be.visible')
    cy.get('[data-cy=remote-home-create-toggle]').click()
    cy.get('[data-cy=remote-home-create-input]').type('connect-test')
    cy.get('[data-cy=remote-home-create-submit]').click()
    cy.get('[data-cy=remote-status]').should('contain', 'No remote linked')
    cy.get('[data-cy=remote-menu-overview]').should('exist')
    cy.get('[data-cy=remote-menu-branches]').should('not.exist')
    cy.get('[data-cy=remote-menu-commits]').should('not.exist')

    cy.get('[data-cy=remote-modal-close]').click()

    runCommand('git init')
    runCommand('git add .')
    runCommand('git commit -m "init"')
    runCommand('git remote add origin https://remote.mock/connect-test')
    runCommand('git push -u origin main')

    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-remote]').click()

    cy.get('[data-cy=remote-menu-home]').click()
    cy.get('[data-cy=remote-home-repo][data-repo="connect-test"]').click()
    cy.get('[data-cy=remote-status]').should('contain', 'Linked: origin')
    cy.get('[data-cy=remote-menu-branches]').should('exist')
    cy.get('[data-cy=remote-menu-commits]').should('exist')
  })
})
