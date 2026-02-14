# 🗺️ chizu

`chizu` (Japanese for "map") is a lightweight CLI tool to generate a concise repository map of your codebase. It extracts key entities like classes, functions, and methods while respecting your project's structure—perfect for giving LLMs (like ChatGPT, Claude, or Gemini) and coding agents (like `Claude Code`, Gemini CLI or `opencode`) the right context without wasting tokens.

Powered by [code-chopper](https://github.com/sirasagi62/code-chopper).

## ✨ Features

- **AST-based Extraction**: Uses Tree-sitter to identify meaningful code boundaries rather than just regex patterns.
- **AI-Optimized**: Generates a high-density "map" of your repo to help AI understand your codebase's architecture.
- **Smart Filtering**: Automatically respects `.gitignore` and ignores noisy directories (node_modules, .git, etc.).
- **Safe Concurrency**: Built-in concurrency control to prevent `EMFILE` errors even on massive repositories.
- **Compress Mode**: A dedicated mode to show only signatures for maximum token efficiency.

## 🚀 Quick Start

You can run it instantly via npx:

```bash
npx @sirasagi62/chizu [directory]
```

Or install it globally:

```bash
npm install -g @sirasagi62/chizu
```

## 📖 Usage

### Basic Map
Generate a map of the current directory:
```bash
chizu
```

### Compress Mode
Show only signatures/definitions (ideal for large repos):
```bash
chizu --compress
```

### Specific Directory
```bash
chizu ./src
```

## 🛠️ CLI Options

| Option | Shorthand | Description | Default |
| :--- | :--- | :--- | :--- |
| `directory` | - | The target directory to map | `.` |
| `--compress` | `-c` | Only show signatures and hide docs/bodies | `false` |
| `--help` | `-h` | Display help information | - |

## 💡 Why chizu?

When working with AI, pasting entire files is often overkill and hits context limits. `chizu` creates a "table of contents" for your code, allowing the AI to see how everything connects before you dive into specific implementation details.

## Acknowledgement
This tool is inspired by aider's repomap.

## License

MIT
