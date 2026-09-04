import React, { useEffect, useState } from 'react';
import Explorer from './components/Sidebar/Explorer';
import CodeEditor from './components/Editor/CodeEditor';
import AIAgent from './components/Terminal/AIAgent';
import RealTerminal from './components/Terminal/RealTerminal';
import GlobalSearch from './components/Search/GlobalSearch';
import Dashboard from './components/Dashboard';
import SettingsModal from './components/Settings/SettingsModal';
import CommandPalette from './components/CommandPalette/CommandPalette';
import WebPreview from './components/Preview/WebPreview';
import DiffModal from './components/Editor/DiffModal';
import MultiFileDiffModal from './components/Editor/MultiFileDiffModal';
import ConfirmDialog from './components/Dialogs/ConfirmDialog';
import AlertDialog from './components/Dialogs/AlertDialog';
import { useStore } from './store/useStore';
import { fileService } from './services/fileService';
import { Files, Search, Settings, TerminalSquare, Code2, X, ArrowLeft, Play, LayoutTemplate, FileJson, FileType, FileCode2, Hash, Bot } from 'lucide-react';

const FileTabIcon = ({ name }: { name: string }) => {
  if (name.endsWith('.tsx') || name.endsWith('.ts')) return <FileCode2 size={12} className="text-[#00ff00]" />;
  if (name.endsWith('.js') || name.endsWith('.jsx')) return <FileCode2 size={12} className="text-yellow-400" />;
  if (name.endsWith('.css')) return <Hash size={12} className="text-blue-400" />;
  if (name.endsWith('.json')) return <FileJson size={12} className="text-yellow-600" />;
  if (name.endsWith('.html')) return <FileType size={12} className="text-orange-500" />;
  return <FileType size={12} className="text-gray-400" />;
};

const App = () => {
  const {
    currentView, setView, activeFilePath, flatFiles, unsavedFilePaths,
    openFiles, setActiveFile, closeFile, isSettingsOpen, toggleSettings,
    isPaletteOpen, togglePalette, projectName, projectPath, setFiles, updateFileContent,
    pendingDiff, setPendingDiff, markUnsaved, confirmDialog, showConfirm, hideConfirm,
    alertDialog, hideAlert
  } = useStore();

  const activeFile = flatFiles.find(f => f.path === activeFilePath);
  const [showPreview, setShowPreview] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [rightPanelMode, setRightPanelMode] = useState<'ai' | 'terminal'>('ai');
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  //
  useEffect(() => {
    if (currentView === 'editor' && projectPath) {
      // Suscribirse a cambios de archivos
      window.electronAPI.onFileChange(async (data) => {

        // 1. Si se agrega o borra un archivo, recargamos todo el árbol
        if (data.event === 'add' || data.event === 'unlink' || data.event === 'addDir' || data.event === 'unlinkDir') {
          const newFiles = await fileService.getProjectFiles(projectPath);
          setFiles(newFiles);
        }

        // 2. Si el archivo modificado es el que tengo abierto, actualizamos contenido
        if (data.event === 'change' && data.path === activeFilePath) {
          // Solo actualizamos si NO tenemos cambios sin guardar (para no sobreescribir al usuario)
          if (!unsavedFilePaths.includes(data.path)) {
            const newContent = await fileService.readFile(data.path);
            updateFileContent(newContent);
          } else {
            // Aquí podrías mostrar un aviso (toast)
          }
        }
      });
    }
  }, [currentView, projectPath, activeFilePath, unsavedFilePaths, setFiles, updateFileContent]);

  //
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); if (currentView === 'editor') togglePalette(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); toggleSettings(true); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') { e.preventDefault(); if (currentView === 'editor') setShowGlobalSearch(true); }
      if (e.key === 'F5') { if (showPreview) { e.preventDefault(); setRefreshTrigger(prev => prev + 1); } }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [currentView, togglePalette, toggleSettings, showPreview]);

  const handleConfirmDiff = async () => {
    if (pendingDiff) {
      // Nuevo formato multi-archivo
      if (pendingDiff.files && Array.isArray(pendingDiff.files)) {
        try {
          for (const fileDiff of pendingDiff.files) {
            await fileService.saveFile(fileDiff.path, fileDiff.modified);
          }
          // Refrescar árbol de archivos
          if (projectPath) {
            const newFiles = await fileService.getProjectFiles(projectPath);
            setFiles(newFiles);
          }
        } catch (error) {
          console.error('Error applying multi-file diff:', error);
        }
      } else {
        // Formato antiguo de archivo único
        updateFileContent(pendingDiff.modified);
        markUnsaved(pendingDiff.targetPath);
      }
      setPendingDiff(null);
    }
  };

  const handleCloseFile = (path: string) => {
    // Verificar si el archivo tiene cambios sin guardar
    const isDirty = unsavedFilePaths.includes(path);

    if (isDirty) {
      const fileName = flatFiles.find(f => f.path === path)?.name || 'file';

      showConfirm({
        title: 'Unsaved Changes',
        message: `"${fileName}" has unsaved changes.\n\nDo you want to close it and discard changes?`,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep Editing',
        danger: true,
        onConfirm: () => {
          closeFile(path);
          hideConfirm();
        }
      });
      return;
    }

    // Proceder con el cierre
    closeFile(path);
  };

  if (currentView === 'dashboard') {
    return (
      <div className="relative h-full w-full">
        <Dashboard />
        <button onClick={() => toggleSettings(true)} className="absolute bottom-4 left-4 p-2 text-gray-500 hover:text-white transition-colors"><Settings size={24} /></button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-black text-[#cccccc] font-mono overflow-hidden selection:bg-[#00ff00] selection:text-black">
      {isSettingsOpen && <SettingsModal />}
      {isPaletteOpen && <CommandPalette />}
      {showGlobalSearch && <GlobalSearch onClose={() => setShowGlobalSearch(false)} />}
      {pendingDiff && (
        pendingDiff.files && Array.isArray(pendingDiff.files) ? (
          <MultiFileDiffModal
            files={pendingDiff.files}
            onConfirm={handleConfirmDiff}
            onCancel={() => setPendingDiff(null)}
          />
        ) : (
          <DiffModal
            originalContent={pendingDiff.original}
            modifiedContent={pendingDiff.modified}
            language={activeFile?.language || 'plaintext'}
            onConfirm={handleConfirmDiff}
            onCancel={() => setPendingDiff(null)}
          />
        )
      )}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onCancel={hideConfirm}
        />
      )}
      {alertDialog && (
        <AlertDialog
          title={alertDialog.title}
          message={alertDialog.message}
          type={alertDialog.type}
          onClose={hideAlert}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-14 bg-black border-r border-[#222] flex flex-col items-center py-4 justify-between z-20 shrink-0">
          <div className="flex flex-col gap-8 w-full">
            <div className="flex justify-center w-full cursor-pointer text-gray-500 hover:text-white" onClick={() => setView('dashboard')} title="Back to Dashboard"><ArrowLeft size={24} /></div>
            <div className="relative w-full flex justify-center cursor-pointer group"><div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#00ff00] shadow-[0_0_8px_#00ff00]"></div><Files size={28} className="text-[#00ff00]" strokeWidth={1.5} /></div>
            <div className="flex justify-center w-full cursor-pointer text-gray-500 hover:text-[#00ff00] transition-colors" onClick={() => setShowGlobalSearch(true)} title="Search in Files (Ctrl+Shift+F)"><Search size={26} strokeWidth={1.5} /></div>
            <div className={`flex justify-center w-full cursor-pointer transition-opacity ${showPreview ? 'text-[#00ff00] opacity-100' : 'text-gray-500 opacity-50 hover:opacity-100'}`} onClick={() => setShowPreview(!showPreview)} title="Toggle Live Preview"><LayoutTemplate size={26} strokeWidth={1.5} /></div>
          </div>
          <div className="flex flex-col gap-6 mb-2"><div className="flex justify-center w-full cursor-pointer text-gray-600 hover:text-white transition-colors" onClick={() => toggleSettings(true)} title="Settings"><Settings size={28} strokeWidth={1.5} /></div></div>
        </aside>

        {/* EXPLORER */}
        <div className="h-full bg-black border-r border-[#222] shrink-0"><Explorer /></div>

        {/* CENTER AREA */}
        <div className="flex-1 flex flex-col min-w-0 bg-black relative">
          <div className="h-9 bg-black border-b border-[#222] flex items-center justify-between px-0 shrink-0 select-none">
            <div className="flex items-end h-full overflow-x-auto custom-scrollbar flex-1">
              {openFiles.map(path => {
                const file = flatFiles.find(f => f.path === path);
                if (!file) return null;
                const isActive = activeFilePath === path;
                const isDirty = unsavedFilePaths.includes(path);
                return (
                  <div key={path} onClick={() => { setActiveFile(path, file.content || ''); }}
                    className={`group flex items-center gap-2 px-3 h-full border-r border-[#222] cursor-pointer text-xs min-w-[120px] max-w-[200px] ${isActive ? 'bg-[#111] text-white border-t-[2px] border-t-[#00ff00]' : 'bg-black text-gray-500 hover:bg-[#0a0a0a] border-t-[2px] border-t-transparent'}`}>
                    <FileTabIcon name={file.name} />
                    <span className={`truncate flex-1 ${isDirty ? 'text-yellow-500 italic' : ''}`}>{file.name}</span>
                    <div className="w-5 h-5 flex items-center justify-center rounded-sm hover:bg-white/10" onClick={(e) => { e.stopPropagation(); handleCloseFile(path); }}>
                      {isDirty ? <div className="w-2 h-2 rounded-full bg-white group-hover:hidden"></div> : <X size={12} className="text-gray-500 hover:text-white" />}
                      {isDirty && <X size={12} className="text-white hidden group-hover:block" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center px-2 h-full bg-[#0a0a0a] border-l border-[#222]">
              <button className="flex items-center gap-1 text-[#00ff00] hover:text-white hover:bg-[#00ff00]/20 px-3 py-1 rounded-sm transition-all text-[10px] font-bold tracking-wider" onClick={() => { if (!showPreview) setShowPreview(true); setRefreshTrigger(prev => prev + 1); }}><Play size={10} fill="currentColor" /> RUN</button>
            </div>
          </div>

          <div className="flex-1 flex relative overflow-hidden">
            <div className={`h-full ${showPreview ? 'w-1/2 border-r border-[#222]' : 'w-full'} transition-all duration-300`}>
              {activeFilePath ? <CodeEditor /> : <div className="h-full flex flex-col items-center justify-center pointer-events-none select-none opacity-30"><Code2 size={80} className="text-[#333] mb-4" strokeWidth={1} /><h1 className="text-2xl font-bold tracking-[0.2em] text-[#333] uppercase">{projectName}</h1></div>}
            </div>
            {showPreview && <div className="w-1/2 h-full bg-white animate-in fade-in slide-in-from-right-10 duration-300"><WebPreview files={flatFiles} refreshTrigger={refreshTrigger} /></div>}
          </div>
        </div>

        {/* RIGHT PANEL - AI / TERMINAL */}
        <div className="w-[350px] bg-black border-l border-[#222] flex flex-col shrink-0">
          {/* Panel Header with Tabs */}
          <div className="h-9 border-b border-[#222] flex items-center justify-between px-2 bg-[#050505] shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setRightPanelMode('ai')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors ${rightPanelMode === 'ai'
                  ? 'bg-[#00ff00]/10 text-[#00ff00]'
                  : 'text-[#555] hover:text-[#888] hover:bg-white/5'
                  }`}
              >
                <Bot size={12} />
                AI
              </button>
              <button
                onClick={() => setRightPanelMode('terminal')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors ${rightPanelMode === 'terminal'
                  ? 'bg-[#00ff00]/10 text-[#00ff00]'
                  : 'text-[#555] hover:text-[#888] hover:bg-white/5'
                  }`}
              >
                <TerminalSquare size={12} />
                Terminal
              </button>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-[#00ff00] shadow-[0_0_5px_#00ff00]"></div>
          </div>

          {/* Panel Content */}
          <div className="flex-1 h-full relative overflow-hidden">
            {rightPanelMode === 'ai' ? <AIAgent /> : <RealTerminal />}
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      {currentView === 'editor' && (
        <footer className="h-6 bg-black border-t border-[#222] flex items-center px-2 text-[10px] text-gray-500">
          <span>{activeFile ? activeFile.path : 'READY'}</span>
        </footer>
      )}
    </div>
  );
};
export default App;
