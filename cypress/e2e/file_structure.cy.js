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

describe('file structure interactions', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('toggles folders open and closed', () => {
    cy.get('[data-cy=file-structure-toggle][data-path="/src"]').click()
    cy.get('[data-cy=file-structure-file][data-path="/src/index.txt"]').should(
      'not.exist'
    )
    cy.get('[data-cy=file-structure-toggle][data-path="/src"]').click()
    cy.get('[data-cy=file-structure-file][data-path="/src/index.txt"]').should('exist')
  })

  it('opens a file from the tree in the editor', () => {
    cy.get('[data-cy=file-structure-file][data-path="/README.txt"]')
      .find('[data-cy=file-structure-open]')
      .click()
    cy.get('[data-cy=editor-tab][data-path="/README.txt"]').should('exist')
  })

  it('creates folders and files from the terminal and reflects them in the tree', () => {
    runCommand('mkdir /docs/cypress')
    runCommand('touch /docs/cypress/notes.txt')
    runCommand('ls /docs/cypress')
    cy.get('[data-cy=terminal-body]').should('contain', 'notes.txt')

    cy.get('[data-cy=file-structure-toggle][data-path="/docs"]').click()
    cy.get('[data-cy=file-structure-toggle][data-path="/docs/cypress"]').click()
    cy.get('[data-cy=file-structure-file][data-path="/docs/cypress/notes.txt"]')
      .find('[data-cy=file-structure-open]')
      .click()
    cy.get('[data-cy=editor-tab][data-path="/docs/cypress/notes.txt"]').should(
      'exist'
    )
  })

  it('creates folders and files from the UI modal', () => {
    cy.get('[data-cy=file-structure-new]').click()
    cy.get('[data-cy=file-structure-new-menu]').should('be.visible')
    cy.get('[data-cy=file-structure-new-folder]').click()
    cy.get('[data-cy=file-structure-create-input]').type('ui-folder')
    cy.get('[data-cy=file-structure-create-confirm]').click()
    cy.get('[data-cy=file-structure-folder][data-path="/ui-folder"]').should(
      'exist'
    )

    cy.get('[data-cy=file-structure-new]').click()
    cy.get('[data-cy=file-structure-new-file]').click()
    cy.get('[data-cy=file-structure-create-input]').type('ui-note')
    cy.get('[data-cy=file-structure-create-confirm]').click()
    cy.get('[data-cy=file-structure-file][data-path="/ui-note.txt"]').should(
      'exist'
    )
    cy.get('[data-cy=editor-tab][data-path="/ui-note.txt"]').should('exist')
  })
})
