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

  describe('terminal cursor navigation', () => {
    const getCursorOffset = () => {
      return cy
        .get('.terminal-pane__input-wrap')
        .invoke('css', '--cursor-offset')
        .then((val) => parseInt(val, 10))
    }

    it('positions cursor at end when typing', () => {
      cy.get('[data-cy=terminal-input]').type('hello')
      getCursorOffset().should('eq', 5)
    })

    it('moves cursor left with ArrowLeft key', () => {
      cy.get('[data-cy=terminal-input]').type('hello')
      getCursorOffset().should('eq', 5)
      cy.get('[data-cy=terminal-input]').type('{leftArrow}{leftArrow}')
      getCursorOffset().should('eq', 3)
    })

    it('moves cursor right with ArrowRight key', () => {
      cy.get('[data-cy=terminal-input]').type('hello')
      cy.get('[data-cy=terminal-input]').type('{leftArrow}{leftArrow}{leftArrow}')
      getCursorOffset().should('eq', 2)
      cy.get('[data-cy=terminal-input]').type('{rightArrow}')
      getCursorOffset().should('eq', 3)
    })

    it('moves cursor to start with Home key', () => {
      cy.get('[data-cy=terminal-input]').type('hello')
      getCursorOffset().should('eq', 5)
      cy.get('[data-cy=terminal-input]').type('{home}')
      getCursorOffset().should('eq', 0)
    })

    it('moves cursor to end with End key', () => {
      cy.get('[data-cy=terminal-input]').type('hello')
      cy.get('[data-cy=terminal-input]').type('{home}')
      getCursorOffset().should('eq', 0)
      cy.get('[data-cy=terminal-input]').type('{end}')
      getCursorOffset().should('eq', 5)
    })

    it('resets cursor to 0 after submitting command', () => {
      cy.get('[data-cy=terminal-input]').type('help{enter}')
      getCursorOffset().should('eq', 0)
    })

    it('positions cursor at end when navigating history with ArrowUp', () => {
      cy.get('[data-cy=terminal-input]').type('first{enter}')
      cy.get('[data-cy=terminal-input]').type('second{enter}')
      cy.get('[data-cy=terminal-input]').type('{upArrow}')
      cy.get('[data-cy=terminal-input]').should('have.value', 'second')
      getCursorOffset().should('eq', 6)
    })

    it('positions cursor at end when navigating history with ArrowDown', () => {
      cy.get('[data-cy=terminal-input]').type('first{enter}')
      cy.get('[data-cy=terminal-input]').type('second{enter}')
      cy.get('[data-cy=terminal-input]').type('{upArrow}{upArrow}')
      cy.get('[data-cy=terminal-input]').should('have.value', 'first')
      cy.get('[data-cy=terminal-input]').type('{downArrow}')
      cy.get('[data-cy=terminal-input]').should('have.value', 'second')
      getCursorOffset().should('eq', 6)
    })
  })
})
