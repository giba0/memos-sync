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
4. Select the built `dist/` folder, or import a ZIP containing its contents. The source HTML is a template; the build embeds its Markdown renderer and logo.

## Continuous Development

To watch TypeScript compilation, run:
```bash
npm run dev
```

This does not rebuild the plugin bundle or HTML. Run `npm run build` again after changes before testing in the host.

## Running Tests

```bash
npm test
```
