# CS Core Portal

A local replica of the CS Core Portal with a dependency-free Python backend.
The directory and the admin workspace read the same persistent catalog.
Folders and documents can be created and managed through the admin page.

## Run locally

From this directory, run:

    python3 server.py

The server checks ports 13000 through 13100 and uses the first available one.
Open the URL printed in the terminal. The server binds to localhost by default.
Use `python3 server.py --port 13002` to start checking at a different port.

## Manage folders and documents

Open the local URL and choose **Teacher Sign In** to access content
management. The local demo credentials are username **teacher123** and
password **admin@321**. After signing in, the content manager can create
subjects and folders, upload PDFs, and edit or delete materials. Direct
/admin/ access and all write APIs require a teacher session.

Create subjects with a name, course code, description, and icon. An optional
first folder can be created at the same time. New subjects appear in the
directory and all admin selectors. Folder names are checked for duplicates.
Deleting a folder removes its documents from the catalog and deletes locally
stored PDFs. Existing remote PDFs are removed from the local catalog only.

Uploads are limited to PDF files up to 25 MiB. Changes persist in
data/demo.json; uploaded PDFs live in storage/documents/.

New teachers can choose **Create an account** on the Teacher Sign In page.
Accounts use a unique username and a password of at least 10 characters.
Registration signs the teacher in immediately so they can contribute to the
shared study library. Password hashes are salted and stored in
`data/teachers.json`; raw passwords are not saved. The built-in local account
can still be configured with CS_PORTAL_TEACHER_USERNAME and
CS_PORTAL_TEACHER_PASSWORD. The server binds to 127.0.0.1 by default; keep
the demo server on localhost.

## Deploy the website

This project serves its static UI from Vercel and runs the existing Python
server as a Render web service. Vercel proxies `/api/*` to Render, so the
browser uses one website origin for both the UI and API. The Render service
uses a persistent disk for the catalog, teacher accounts, and uploaded PDFs.

The Render service needs a paid plan for its persistent disk. A free Render
service has an ephemeral filesystem, so uploaded documents and account data
would be lost when it restarts or deploys.

### Before deployment

1. Push this project to a Git repository. The portal is in the `webdev`
   subdirectory, so select `webdev` as the project root in Vercel.
2. In Render, create a Blueprint from this repository and set the Blueprint
   path to `webdev/render.yaml`. The file defines the Python API service and
   its persistent disk.
3. When Render asks for `CS_PORTAL_TEACHER_USERNAME` and
   `CS_PORTAL_TEACHER_PASSWORD`, enter the production teacher credentials.
   The hosted service refuses to start if those values are missing.
4. Wait for the Render service to finish deploying and copy its HTTPS URL,
   such as `https://cs-core-portal-api.onrender.com`.
5. In Vercel, import the same repository and set **Root Directory** to
   `webdev`. Use the **Other** framework preset and set the environment
   variable `CS_PORTAL_API_ORIGIN` to the Render HTTPS origin (no path or
   trailing slash). `vercel.mjs` serves `public/` and proxies `/api/*` to that
   origin.
6. Deploy the Vercel project. Copy its production HTTPS URL.
7. In Render, add `CS_PORTAL_ALLOWED_ORIGINS` with the exact Vercel origin,
   for example `https://your-project.vercel.app`, then restart or redeploy the
   service. Add any custom domain as another comma-separated origin.
8. In Vercel, redeploy after setting `CS_PORTAL_API_ORIGIN` if it was added
   after the first deployment.

The API origin can be omitted for the first Vercel deployment; that deployment
will serve the UI only. Add the origin and redeploy to connect the API. Keep
`.env` files, `data/teachers.json`, and uploaded PDFs out of Git. The first
Render start copies `data/demo.json` to the persistent disk, then future catalog
changes are saved there.

For a deploy from the terminal, install and authenticate the Vercel CLI, then
run `vercel` for a preview or `vercel --prod` for production from `webdev`.
The `CS_PORTAL_API_ORIGIN` environment variable must be set in the Vercel
project before the production deployment that should proxy API traffic.

## API

- POST /api/teachers — create a teacher account and sign in
- GET /api/health — server status, counts, and current limits
- GET /api/catalog — all subjects, folders, and document metadata
- GET /api/hierarchy — subjects and folder names
- GET /api/materials — every document
- GET /api/materials?subject=Python — documents for one subject
- POST /api/subjects — JSON object with name, code, description, icon, and optional firstFolder
- POST /api/folders — JSON object with subject and folder (or name)
- DELETE /api/folders — remove a subject folder and its document records
- POST /api/upload — multipart PDF upload with subject, folder, title,
  optional description, and a `pdf` file field
- POST /api/materials — compatible multipart upload using a `file` field
- PUT /api/materials/{document-id} — update title, folder, and description
- PUT /api/materials/{document-id}/replace-pdf — replace a PDF file
- DELETE /api/materials/{document-id} — remove a document record
- GET /api/files/{document-id} — retrieve a locally uploaded PDF

Catalog reads remain public; all subject, folder, and document changes require
an active teacher session. Existing source PDFs keep their original remote
URLs; new uploads and replacements are stored locally.
