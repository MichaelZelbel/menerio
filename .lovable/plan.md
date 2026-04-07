

## Fix ChatGPT Guide + Show Access Key in URLs

### Problems
1. ChatGPT connection steps are outdated/incorrect
2. User has no way to see or copy the access key from the UI
3. All config snippets say "YOUR_ACCESS_KEY" — user must manually replace

### Solution

**1. Add Access Key input field (stored in localStorage)**

Add a text input at the top of the MCP Connection card where the user pastes their `MCP_ACCESS_KEY` once. Store it in `localStorage`. Once set, all config snippets and URLs automatically include the real key instead of "YOUR_ACCESS_KEY".

- Input with show/hide toggle and copy button
- Hint: "Paste the value you set as MCP_ACCESS_KEY in your Supabase project secrets"
- All snippets dynamically use the stored key or fall back to "YOUR_ACCESS_KEY" placeholder

**2. Fix ChatGPT guide steps**

Update to match actual ChatGPT UI:
1. Go to **Settings** → **Apps** → **Advanced Settings**
2. Enable the **Developer** toggle
3. Click **Create App**
4. For Authentication, select **None** (the key is embedded in the URL)
5. Paste the MCP URL (with `?key=...` already included)
6. Save and start using tools

**3. Pre-build the full URL for ChatGPT**

Show the ready-to-copy URL as `{MCP_URL}?key={storedKey}` when the user has entered their key, so they can just copy and paste it directly.

### Files to change
- `src/components/settings/MCPConnectionManager.tsx` — add key input, fix ChatGPT steps, dynamically populate all snippets

