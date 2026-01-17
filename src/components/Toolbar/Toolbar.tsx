interface ToolbarProps {
  title: string;
  isModified: boolean;
}

export function Toolbar({ title, isModified }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-title">
        {title}
        {isModified ? " *" : ""}
      </div>
    </header>
  );
}
