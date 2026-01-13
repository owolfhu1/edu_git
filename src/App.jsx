import './App.css'
import FileStructure from './components/FileStructure'
import EditorArea from './components/EditorArea'
import TerminalPane from './components/TerminalPane'
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
