# AI Adventure MCP Server

An MCP server that lets Claude Desktop convert PDF adventures into Foundry VTT `.bundle` files using your Pro/Max subscription — no API key required.

## How it works

```
Claude Desktop  ──stdio──▶  this MCP server  ──fs──▶  .bundle file
```

You ask Claude Desktop to process a PDF. Claude calls tools exposed by this server to read the PDF in chunks, inspect images, build the adventure structure, and write the bundle ZIP to disk.

## Setup

### 1. Build the server

From the monorepo root:

```bash
npm install
npm run build
```

This produces `apps/ai-adventure-mcp/dist/server.js`.

### 2. Configure Claude Desktop

Edit your Claude Desktop config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add this entry under `mcpServers` (create the section if it's not there):

```json
{
  "mcpServers": {
    "ai-adventure": {
      "command": "node",
      "args": [
        "<<< ABSOLUTE PATH TO >>>/apps/ai-adventure-mcp/dist/server.js"
      ]
    }
  }
}
```

Replace the placeholder with the actual path. On Windows it'll look like:
`C:\\Users\\YourName\\OneDrive\\Documents\\Projects\\adventure-importer\\apps\\ai-adventure-mcp\\dist\\server.js`

(Note the doubled backslashes — JSON requires them.)

### 3. Restart Claude Desktop

Fully quit and reopen Claude Desktop. The server starts automatically when Claude Desktop launches.

### 4. Verify

In Claude Desktop, look for the tools/plug icon near the chat input. You should see `ai-adventure` listed with 6 tools available.

## Usage

Just ask Claude in plain English:

> "Process the PDF at C:\path\to\adventure.pdf into a Foundry bundle. Save it next to the PDF."

Claude will:

1. Call `read_pdf_metadata` to see the file size
2. Call `read_pdf_pages` repeatedly to read text in chunks
3. Call `list_pdf_images` and `extract_pdf_image` to inspect maps
4. Build the adventure JSON structure in its working memory
5. Call `save_bundle_data` to validate and cache the JSON
6. Call `finalize_bundle` to write the ZIP

The `.bundle` file appears at the path you specified. Drop it into the Foundry importer and you're done.

## Tools exposed

| Tool | Purpose |
|---|---|
| `read_pdf_metadata` | Page count, image count, estimated tokens |
| `read_pdf_pages` | Text from a page range |
| `list_pdf_images` | All images with IDs and dimensions |
| `extract_pdf_image` | One image as base64 WebP for vision |
| `save_bundle_data` | Validate & cache the assembled JSON |
| `finalize_bundle` | Write the .bundle ZIP to disk |

## Costs

Zero API costs. Everything runs through your Pro/Max subscription.

## Troubleshooting

**Tools don't appear in Claude Desktop**
Check Claude Desktop's developer logs for errors. Common cause: wrong path in the config, or the server hasn't been built (`npm run build` from repo root).

**"Module not found" errors**
The server depends on built packages — run `npm run build` from the monorepo root, not just `apps/ai-adventure-mcp`.

**Claude can't find the PDF**
Use absolute paths. Relative paths don't work because Claude Desktop's working directory isn't predictable.
