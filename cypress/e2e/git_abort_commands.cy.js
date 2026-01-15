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

const getLatestCommitSha = (branch) => {
  runCommand(`git checkout ${branch}`)
  runCommand('clear')
  runCommand('git log --oneline -n 1')
  return cy
    .get('[data-cy=terminal-line][data-line-type="output"]')
    .last()
    .invoke('text')
    .then((line) => line.trim().split(' ')[0])
}

describe('git abort commands', () => {
  beforeEach(() => {
    cy.visit('/')
    importWorkspace('edu-git-conflict.json')
  })

  it('aborts a conflicted merge', () => {
    runCommand('git checkout main')
    runCommand('git merge test')
    runCommand('git merge --abort')
    cy.get('[data-cy=terminal-body]').should('contain', 'Merge aborted.')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'nothing to commit, working tree clean'
    )
  })

  it('aborts a conflicted rebase', () => {
    runCommand('git checkout test')
    runCommand('git fetch origin')
    runCommand('git rebase origin/main')
    runCommand('git rebase --abort')
    cy.get('[data-cy=terminal-body]').should('contain', 'Rebase aborted.')
    runCommand('clear')
    runCommand('git status')
    cy.get('[data-cy=terminal-body]').should(
      'contain',
      'nothing to commit, working tree clean'
    )
  })

  it('aborts a conflicted cherry-pick', () => {
    getLatestCommitSha('test').then((sha) => {
      runCommand('git checkout main')
      runCommand(`git cherry-pick ${sha}`)
      runCommand('git cherry-pick --abort')
      cy.get('[data-cy=terminal-body]').should('contain', 'Cherry-pick aborted.')
      runCommand('clear')
      runCommand('git status')
      cy.get('[data-cy=terminal-body]').should(
        'contain',
        'nothing to commit, working tree clean'
      )
    })
  })
})
