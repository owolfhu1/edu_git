const runCommand = (command) => {
  cy.get('[data-cy=terminal-input]').type(`${command}{enter}`)
}

const importWorkspace = () => {
  cy.get('[data-cy=workspace-menu-toggle]').click()
  cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
  cy.get('[data-cy=workspace-menu-import]').click()
  cy.get('[data-cy=workspace-menu-import-input]').selectFile(
    'cypress/fixtures/edu-git-diff.json',
    { force: true }
  )
  cy.get('[data-cy=file-structure-file][data-path="/src/index.txt"]', {
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

const openRemoteRepo = (repoName) => {
  cy.get('[data-cy=remote-menu-home]').should('exist')
  cy.get('[data-cy=remote-home-repo][data-repo="edu-git"]', { timeout: 10000 }).then(
    ($repo) => {
      if (repoName && repoName !== 'edu-git') {
        const selector = `[data-cy=remote-home-repo][data-repo="${repoName}"]`
        cy.get(selector).click()
      } else {
        cy.wrap($repo).click()
      }
    }
  )
}

describe('diff views', () => {
  beforeEach(() => {
    cy.visit('/')
    importWorkspace()
  })

  it('shows terminal diffs for added, modified, and deleted lines', () => {
    runCommand('clear')
    runCommand('git diff')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- src/index.txt')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- docs/overview.txt')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- notes/ideas.txt')
    cy.get('[data-cy=terminal-body]').should('contain', '+ Local add line')
    cy.get('[data-cy=terminal-body]').should('contain', '- Initial overview line')
    cy.get('[data-cy=terminal-body]').should('contain', '+ - Updated overview line')
    cy.get('[data-cy=terminal-body]').should('contain', '- Second idea')
  })

  it('shows gutter markers for add, modify, and delete', () => {
    openEditorFile('/src/index.txt')
    cy.get('.editor-area__gutter-line--add').should('exist')

    openEditorFile('/docs/overview.txt')
    cy.get('.editor-area__gutter-line--modified').should('exist')

    openEditorFile('/notes/ideas.txt')
    cy.get('.editor-area__gutter-line--removed').should('exist')
  })

  it('shows gutter diff details and reverts changes', () => {
    openEditorFile('/src/index.txt')
    cy.get('.editor-area__gutter-line--add').first().click()
    cy.get('.editor-area__gutter-menu').should('be.visible')
    cy.get('.editor-area__gutter-menu-diff').should('contain', '+ Local add line')
    cy.get('.editor-area__gutter-menu-diff--add').should('exist')
    cy.get('.editor-area__gutter-menu-action').click()
    cy.get('.editor-area__gutter-menu').should('not.exist')
    cy.get('.editor-area__gutter-line--add').should('not.exist')
  })

  it('refreshes gutter markers after git restore', () => {
    openEditorFile('/src/index.txt')
    cy.get('.editor-area__gutter-line--add').should('exist')

    runCommand('git checkout -- /src/index.txt')

    cy.get('.editor-area__gutter-line--add').should('not.exist')
    cy.get('.editor-area__gutter-line--modified').should('not.exist')
    cy.get('.editor-area__gutter-line--removed').should('not.exist')
  })

  it('shows remote compare diffs for main vs diff_branch', () => {
    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-remote]').click()
    cy.get('[data-cy=remote-modal]').should('be.visible')
    openRemoteRepo('edu-git')
    cy.get('[data-cy=remote-menu-compare]').click()

    cy.get('.remote-repo-modal__compare-bar select').eq(0).select('main')
    cy.get('.remote-repo-modal__compare-bar select').eq(1).select('diff_branch')

    cy.get('.remote-repo-modal__diff-title').should('contain', 'src/index.txt')
    cy.get('.remote-repo-modal__diff-title').should('contain', 'docs/overview.txt')
    cy.get('.remote-repo-modal__diff-title').should('contain', 'notes/ideas.txt')

    cy.get('.remote-repo-modal__diff-badge--modified').should('exist')

    cy.get('.remote-repo-modal__diff-body').should('contain', '+ Remote add line')
    cy.get('.remote-repo-modal__diff-body').should('contain', '- Initial overview line')
    cy.get('.remote-repo-modal__diff-body').should(
      'contain',
      '+ - Remote overview update'
    )
    cy.get('.remote-repo-modal__diff-body').should('contain', '- Second idea')
  })

  it('shows added file diffs in terminal and remote compare', () => {
    runCommand('git checkout main')
    runCommand('git checkout -b add_diff')
    runCommand('mkdir /docs/adds')
    runCommand('touch /docs/adds/new_file.txt')
    runCommand('git add /docs/adds/new_file.txt')
    runCommand('git commit -m "add file"')
    runCommand('git checkout main')
    runCommand('git merge add_diff')
    runCommand('git checkout -b add_remote')
    runCommand('touch /docs/adds/remote_file.txt')
    runCommand('git add /docs/adds/remote_file.txt')
    runCommand('git commit -m "add remote file"')
    runCommand('git push -u origin add_remote')

    runCommand('clear')
    runCommand('git diff HEAD~1')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- docs/adds/remote_file.txt')

    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-remote]').click()
    cy.get('[data-cy=remote-modal]').should('be.visible')
    openRemoteRepo('edu-git')
    cy.get('[data-cy=remote-menu-compare]').click()
    cy.get('.remote-repo-modal__compare-bar select').eq(0).select('main')
    cy.get('.remote-repo-modal__compare-bar select').eq(1).select('add_remote')
    cy.get('.remote-repo-modal__diff-title').should('contain', 'docs/adds/remote_file.txt')
    cy.get('.remote-repo-modal__diff-badge--added').should('exist')
  })

  it('shows deleted file diffs in terminal and remote compare', () => {
    runCommand('git checkout main')
    runCommand('git checkout -b delete_diff')
    runCommand('mkdir /docs/deletes')
    runCommand('touch /docs/deletes/remove_me.txt')
    runCommand('git add /docs/deletes/remove_me.txt')
    runCommand('git commit -m "add delete target"')
    runCommand('git checkout main')
    runCommand('git merge delete_diff')
    runCommand('git push -u origin main')
    runCommand('git checkout -b delete_remote')
    runCommand('git rm /docs/deletes/remove_me.txt')
    runCommand('git commit -m "delete remote file"')
    runCommand('git push -u origin delete_remote')
    runCommand('git fetch origin')

    runCommand('clear')
    runCommand('git diff HEAD~1')
    cy.get('[data-cy=terminal-body]').should('contain', 'diff -- docs/deletes/remove_me.txt')

    cy.get('[data-cy=workspace-menu-toggle]').click()
    cy.get('[data-cy=workspace-menu-panel]').should('be.visible')
    cy.get('[data-cy=workspace-menu-remote]').click()
    cy.get('[data-cy=remote-modal]').should('be.visible')
    openRemoteRepo('edu-git')
    cy.get('[data-cy=remote-menu-compare]').click()
    cy.get('.remote-repo-modal__compare-bar select').eq(0).select('main')
    cy.get('.remote-repo-modal__compare-bar select').eq(1).select('delete_remote')
    cy.get('.remote-repo-modal__diff-title').should('contain', 'docs/deletes/remove_me.txt')
    cy.get('.remote-repo-modal__diff-badge--deleted').should('exist')
  })
})
