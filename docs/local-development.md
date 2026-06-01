# Local Development

Guide for developers wishing to modify or test the plugin locally.

## Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/giba0/memos-sync.git
   cd memos-sync
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Build the Project**:
   ```bash
   npm run build
   ```
   This will compile the TypeScript source files into the `dist/` directory.

## Testing in Super Productivity

1. Open Super Productivity.
2. Go to **Settings** > **Plugins**.
3. Enable **Developer Mode** (if available) or use the **Load from Folder** option.
4. Select the root folder of this repository (where `manifest.json` is located).

## Continuous Development

To automatically rebuild on file changes, run:
```bash
npm run dev
```

## Running Tests

(If tests are implemented)
```bash
npm test
```
