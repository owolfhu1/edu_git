import './App.css'
import { EditorArea, FileStructure, TerminalPane } from './components'
import { FileSystemProvider } from './store/FileSystemContext'

function App() {
  return (
    <FileSystemProvider>
      <div className="app-shell">
        <aside className="app-sidebar">
          <FileStructure />
        </aside>
        <section className="app-main">
          <EditorArea />
          <TerminalPane />
        </section>
      </div>
    </FileSystemProvider>
  )
}

export default App
