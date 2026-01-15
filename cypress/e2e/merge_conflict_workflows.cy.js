const runCommand = (command) => {
  cy.get('[data-cy=terminal-input]').type(`${command}{enter}`)
}

const importWorkspace = (fixtureName) => {
  cy.get('[data-cy=workspace-menu-toggle]').click()
  cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
  cy.get('[data-cy=workspace-menu-import]').click()
  cy.get('[data-cy=workspace-menu-import-input]').selectFile(
    `cypress/fixtures/${fixtureName}`,
    { force: true }
  )
  cy.get('[data-cy=file-structure-file][data-path="/src/README.txt"]', {
    timeout: 20000,
  }).should('exist')
}

const openRemoteMr = () => {
  cy.get('[data-cy=workspace-menu-toggle]').click()
  cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
  cy.get('[data-cy=workspace-menu-remote]').click()
  cy.get('[data-cy=remote-menu-merge-requests]').click()
  cy.get('[data-cy=remote-mr-row][data-slug="conflicted_mr"]').click()
}

const resolveReadmeConflict = () => {
  cy.get('[data-cy=file-structure-file][data-path="/src/README.txt"]')
    .find('[data-cy=file-structure-open]')
    .click()
  cy.get('[data-cy=editor-area]').scrollIntoView()
  cy.get('[data-cy=editor-textarea]')
    .scrollIntoView()
    .click({ force: true })
    .type('{selectall}{backspace}Welcome to Edu Git!{enter}Resolved content.{enter}', {
      force: true,
    })
}

const assertMrNotConflicted = () => {
  cy.contains('Merge blocked by conflicts.').should('not.exist')
}

describe('merge conflict workflows', () => {
  beforeEach(() => {
    cy.visit('/')
    importWorkspace('edu-git-conflict.json')
  })

  it('resolves conflicts with merge strategy', () => {
    openRemoteMr()
    cy.contains('Merge blocked by conflicts.').should('exist')
    cy.get('[data-cy=remote-modal-close]').click()

    runCommand('git fetch origin')
    runCommand('git checkout test')
    runCommand('git pull origin main')
    resolveReadmeConflict()
    runCommand('git add .')
    runCommand('git commit')
    runCommand('git push origin test')

    openRemoteMr()
    assertMrNotConflicted()
  })

  it('resolves conflicts with rebase strategy', () => {
    openRemoteMr()
    cy.contains('Merge blocked by conflicts.').should('exist')
    cy.get('[data-cy=remote-modal-close]').click()

    runCommand('git fetch origin')
    runCommand('git checkout test')
    runCommand('git rebase origin/main')
    resolveReadmeConflict()
    runCommand('git add .')
    runCommand('git rebase --continue')
    runCommand('git push --force-with-lease origin test')

    openRemoteMr()
    assertMrNotConflicted()
  })

  it('resolves conflicts with cherry-pick strategy and updates the MR branch', () => {
    openRemoteMr()
    cy.contains('Merge blocked by conflicts.').should('exist')
    cy.get('[data-cy=remote-modal-close]').click()

    runCommand('git checkout main')
    runCommand('git pull origin main')
    runCommand('git checkout -b test_cherry_resolved')
    runCommand('git cherry-pick 9058276')
    resolveReadmeConflict()
    runCommand('git add .')
    runCommand('git cherry-pick --continue')
    runCommand('git push origin test_cherry_resolved')

    openRemoteMr()
    cy.get('[data-cy=mr-compare-select]').select('test_cherry_resolved')
    assertMrNotConflicted()
  })
})
