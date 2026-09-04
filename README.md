# ⚡ Zenith IDE

[![CI](https://github.com/jc-morales-dev/EDITOR-CODE/actions/workflows/ci.yml/badge.svg)](https://github.com/jc-morales-dev/EDITOR-CODE/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-0F172A.svg)](./LICENSE)

**Status:** `prototype` — Zenith IDE (Electron + React desktop). Not a hosted web demo.

> [!IMPORTANT]
> **Prototype status:** Zenith IDE is an experimental local desktop prototype (Electron + React). Expect rough edges, breaking changes, and incomplete polish. Not a production-ready product.

> A Cyberpunk-themed Integrated Development Environment powered by AI.

Zenith IDE is an **Electron + React desktop prototype**: a code editor with deep AI integration (Gemini). It's not just a chat wrapper; the agent has control over the file system, a real terminal, and "self-healing" capabilities.

It runs locally as a desktop application — there is no hosted web demo. To try
it, clone the repository and follow [Installation & usage](#-installation--usage);
the screenshot below is from a local run.

![Zenith IDE](./assets/zenith-screenshot.png)

## 🎯 Product focus

Zenith IDE is meant as a local tool for exploring AI-assisted development workflows with more control than a simple chat window. The project's goal is to bring editing, terminal, file context, and preview together into a single experience.

## 🚀 Key features

### 🧠 "Aware" AI agent
- **File management:** the agent can create, read, modify, and delete files and folders directly.
- **Context aware:** it understands your project's full structure and the file you're editing.
- **Multi-file diff view:** review the AI's proposed changes in a diff view before applying them.

### 🛡️ Self-healing preview
- **Real-time error detection:** the web preview environment captures runtime (JavaScript) errors and sends them back to the AI agent.
- **Auto-fix:** the AI receives the error automatically and proposes a fix in the code.

### 💻 Integrated real terminal
- **xterm.js** wired to **node-pty** through Electron IPC.
- Runs real system commands (`npm`, `git`, `docker`) straight from the IDE.

### ⚡ Development experience
- **Monaco Editor:** the same core as VS Code, with syntax highlighting and a minimap.
- **AI autocomplete:** smart code suggestions as you type (debounced for performance).
- **Hot reloading:** the file tree updates in real time when there are external changes (using `chokidar`).
- **Global search:** fast text and Regex search across the whole project.

## 🛠️ Tech stack

| Category | Technologies |
|-----------|-------------|
| **Core** | Electron, React, TypeScript, Vite |
| **State management** | Zustand |
| **Editor & terminal** | Monaco Editor, XTerm.js, Node-PTY |
| **AI** | Google Generative AI (Gemini) |
| **Styling** | TailwindCSS |
| **File system** | Node.js FS, Chokidar |

## 📦 Installation & usage

1. **Clone the repository**
   ```bash
   git clone https://github.com/jc-morales-dev/EDITOR-CODE.git
   cd EDITOR-CODE
   ```

2. **Install dependencies**
   ```bash
   npm ci
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

   Then add your API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
   
   Get your API key at: [Google AI Studio](https://aistudio.google.com/app/apikey)

4. **Run in development mode**
   ```bash
   npm run dev
   ```

5. **Create a production build**
   ```bash
   npm run electron-pack
   ```

## 🔒 Security boundaries

- File operations are confined to the opened project root and reject lexical
  traversal, sibling-prefix tricks, path separators or null bytes in standalone
  filenames, and symlink or junction escapes in guarded operations.
- The terminal's initial working directory must resolve inside the opened project.
- Electron navigation is restricted to the expected development origin or the
  packaged application directory; external origins and `javascript:` URLs are
  rejected.
- Focused tests cover filesystem guard helpers, path confinement, navigation, preview
  content, the file-service bridge, and the application store.

These controls reduce accidental or malicious filesystem escape, but commands
run in the real terminal still have the permissions of the local user and must
be reviewed before execution.

## 🧪 Quality

- GitHub Actions CI for `lint`, `typecheck`, `test`, and `build`, plus a check
  that the web bundle is actually emitted. Electron packaging runs in a separate
  job (manual dispatch or a `v*` tag) because it compiles `node-pty` from source.
- Public changelog in [CHANGELOG.md](CHANGELOG.md)
- Smoke tests for the store and the AI service bridge
- No prebuilt installer is currently attached to the public release; use
  `npm run electron-pack` to create a local package.

### Quality scripts

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## 🎯 Basic usage

1. Open the IDE and select a project folder with **"Open Local Folder"**
2. Browse your files in the **Explorer** (left panel)
3. Edit code in the central **Editor** with syntax highlighting
4. Use the **AI Agent** (right panel) to:
   - Generate new code
   - Modify existing files
   - Get code explanations
5. See your changes in real time with the **Live Preview**
6. Run commands in the integrated **Terminal**

## 📄 License

This project is under the MIT License. See the [LICENSE](LICENSE) file for details.
