function App() {
  return (
    <div className="app-shell theme-light">
      <aside className="sidebar">
        <div className="sidebar-header">Open Files</div>
        <div className="sidebar-empty">No documents open yet.</div>
      </aside>
      <div className="main">
        <header className="toolbar">
          <div className="toolbar-title">mdpro</div>
          <div className="toolbar-actions">Draft · Split View</div>
        </header>
        <section className="workspace">
          <div className="pane">
            <div className="pane-title">Editor</div>
            <div className="pane-body">Start typing markdown…</div>
          </div>
          <div className="pane">
            <div className="pane-title">Preview</div>
            <div className="pane-body">Live preview will appear here.</div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
