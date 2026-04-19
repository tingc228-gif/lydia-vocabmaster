<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/274e6e0e-6319-48bd-a929-027b3559d0dc

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set server-side keys in Netlify environment variables or a local `.env` file:
   `MOONSHOT_API_KEY=...`
   `MINIMAX_API_KEY=...`
   `NOTION_TOKEN=...`
   `NOTION_DATA_SOURCE_ID=8022ec58-e96d-83a5-a510-07d09e275795`
   `NOTION_PET_STATE_DATA_SOURCE_ID=64008614-d7a5-4ce6-adda-d7c64a1fb47f`
   `NOTION_API_VERSION=2025-09-03`

`NOTION_DATA_SOURCE_ID` now points to the `A2 Key 2020 单词数据库`.
`NOTION_PET_STATE_DATA_SOURCE_ID` now points to the companion `A2 Key 2020 Pet State` database that stores the kitten progress.
3. Run with Netlify Functions enabled:
   `npx netlify dev`

This app no longer stores model API keys in the browser. Requests are sent to Netlify Functions, which read the keys from server-side environment variables.
