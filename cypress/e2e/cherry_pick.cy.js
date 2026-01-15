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

describe('cherry-pick workflow', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('cherry-picks a commit from a feature branch', () => {
    const cherryNote = 'Cherry pick note'

    runCommand('git checkout -b cherry_branch')
    openEditorFile('/src/index.txt')
    cy.get('[data-cy=editor-textarea]')
      .scrollIntoView()
      .click({ force: true })
      .type(`{moveToEnd}{enter}${cherryNote}`)

    runCommand('git add /src/index.txt')
    runCommand('git commit -m "cherry change"')
    runCommand('clear')
    runCommand('git rev-parse --short HEAD')

    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .then((sha) => {
        const trimmed = sha.trim()
        expect(trimmed).to.match(/^[0-9a-f]{7}$/i)
        runCommand('git checkout main')
        runCommand(`git cherry-pick ${trimmed}`)
        runCommand('clear')
        runCommand('git log --oneline -n 1')
        cy.get('[data-cy=terminal-line][data-line-type="output"]')
          .last()
          .should('contain', 'cherry change')
      })

    cy.get('[data-cy=editor-textarea]', { timeout: 10000 }).should(
      'contain',
      cherryNote
    )
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .should('contain', 'working tree clean')
  })
})
