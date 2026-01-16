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
  cy.get('[data-cy=editor-textarea]')
    .invoke('text')
    .then((text) => {
      expect(text).to.contain('<<<<<<<')
      expect(text).to.contain('=======')
      expect(text).to.contain('>>>>>>>')
      const lines = text.split('\n')
      expect(lines.some((line) => line.trim().startsWith('<<<<<<<'))).to.eq(true)
      expect(lines.some((line) => line.trim().startsWith('======='))).to.eq(true)
      expect(lines.some((line) => line.trim().startsWith('>>>>>>>'))).to.eq(true)
    })
}

const setupConflict = (filePath, baseLine, branchLine) => {
  runCommand('git checkout -b conflict_branch')
  editFile(filePath, branchLine)
  runCommand(`git add ${filePath}`)
  runCommand('git commit -m "branch conflict change"')
  runCommand('git checkout main')
  editFile(filePath, baseLine)
  runCommand(`git add ${filePath}`)
  runCommand('git commit -m "base conflict change"')
  runCommand('git checkout conflict_branch')
}

describe('conflict marker workflows', () => {
  beforeEach(() => {
    cy.visit('/')
    openMockEnvironment()
  })

  it('shows conflict markers for merge conflicts (src/index.txt)', () => {
    setupConflict('/src/index.txt', 'Base merge line', 'Branch merge line')
    runCommand('git merge main')
    openEditorFile('/src/index.txt')
    assertConflictMarkers()
  })

  it('shows conflict markers for merge conflicts (docs/overview.txt)', () => {
    setupConflict('/docs/overview.txt', 'Base overview line', 'Branch overview line')
    runCommand('git merge main')
    openEditorFile('/docs/overview.txt')
    assertConflictMarkers()
  })

  it('shows conflict markers for cherry-pick conflicts (notes/ideas.txt)', () => {
    runCommand('git checkout -b conflict_branch')
    editFile('/notes/ideas.txt', 'Branch ideas line')
    runCommand('git add /notes/ideas.txt')
    runCommand('git commit -m "branch conflict change"')
    runCommand('git checkout main')
    editFile('/notes/ideas.txt', 'Base ideas line')
    runCommand('git add /notes/ideas.txt')
    runCommand('git commit -m "base conflict change"')
    runCommand('git checkout conflict_branch')
    runCommand('clear')
    runCommand('git log --oneline -n 1')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .then((line) => {
        const sha = line.trim().split(' ')[0]
        runCommand('git checkout main')
        runCommand(`git cherry-pick ${sha}`)
      })
    openEditorFile('/notes/ideas.txt')
    assertConflictMarkers()
  })

  it('shows conflict markers for cherry-pick conflicts (src/components/App.txt)', () => {
    runCommand('git checkout -b conflict_branch')
    editFile('/src/components/App.txt', 'Branch app line')
    runCommand('git add /src/components/App.txt')
    runCommand('git commit -m "branch conflict change"')
    runCommand('git checkout main')
    editFile('/src/components/App.txt', 'Base app line')
    runCommand('git add /src/components/App.txt')
    runCommand('git commit -m "base conflict change"')
    runCommand('git checkout conflict_branch')
    runCommand('clear')
    runCommand('git log --oneline -n 1')
    cy.get('[data-cy=terminal-line][data-line-type="output"]')
      .last()
      .invoke('text')
      .then((line) => {
        const sha = line.trim().split(' ')[0]
        runCommand('git checkout main')
        runCommand(`git cherry-pick ${sha}`)
      })
    openEditorFile('/src/components/App.txt')
    assertConflictMarkers()
  })

  it('shows conflict markers for stash apply conflicts (docs/overview.txt)', () => {
    editFile('/docs/overview.txt', 'Stash overview line')
    runCommand('git stash -m "stash conflict"')
    editFile('/docs/overview.txt', 'Current overview line')
    runCommand('git stash apply')
    openEditorFile('/docs/overview.txt')
    assertConflictMarkers()
  })
})
