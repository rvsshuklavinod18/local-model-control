# Local Model Control

A loopback-only dashboard for Ollama model, GPU, and routed inference activity.

## Run

Requirements: Node.js 20.19+ and a local Ollama installation.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The UI is served by Vite; its local API and Ollama proxy listen on `127.0.0.1:3210`.

## Route Agent Requests

Only inference requests sent through the dashboard proxy appear in the activity ledger. In Cline, select the Ollama provider and set the base URL to `http://127.0.0.1:3210/ollama`. Use the same base URL in Continue's Ollama provider configuration. Select `qwen2.5-coder:3b` as the model.

The ledger stores request metadata (model, endpoint, status, and duration), not prompt or response text. VS Code agent actions such as file edits remain in the agent's own task history. Clients that keep using `http://127.0.0.1:11434` bypass the ledger.

## GPU Budget

On Windows, `OLLAMA_GPU_OVERHEAD` is read from the current user's environment. It reserves VRAM in Ollama's scheduler; it is a scheduling budget, not a hard hardware-enforced limit. `OLLAMA_KEEP_ALIVE` controls how long an idle model remains loaded. NVIDIA telemetry comes from `nvidia-smi`; some laptop fan controllers do not expose RPM.

## Controls

- **Stop** unloads a model and releases its VRAM.
- **Remove model** deletes that model's local files after confirmation.
- **Uninstall Ollama** uses WinGet after confirmation. Model files are preserved unless the additional checkbox is selected.

Activity metadata is stored locally in `data/activity.jsonl`. The app binds only to loopback and is not intended to be exposed to a network.

## Docker

With Docker Desktop (WSL 2) or Docker Engine plus Compose:

```powershell
docker compose up --build -d
```

Open `http://127.0.0.1:3210`. The Compose file publishes only on loopback and persists the activity ledger in a named volume. `docker compose down` removes the dashboard container but keeps that volume; `docker compose down -v` also deletes the ledger.

Ollama remains installed on the host. The container connects through `host.docker.internal`; Ollama must be reachable from the Docker network for model controls and inference logging to work. On Windows, Ollama's default loopback listener may not accept Docker bridge connections. If you change `OLLAMA_HOST` to listen on a host interface, restrict inbound port 11434 with Windows Firewall to the local Docker network. This project does not change that host setting. GPU telemetry may be unavailable inside Docker because the Windows `nvidia-smi` executable is not automatically exposed to a Linux container.

The container cannot uninstall the host Ollama app; use `docker compose down` to remove the dashboard. The native Windows dashboard retains its confirmed Ollama uninstall control.

## CI/CD

GitHub Actions runs the integration test, lint, and frontend build on pull requests to `main`, then builds and smoke-tests the Docker image. Pushes to `main` and version tags such as `v1.2.0` publish a Linux AMD64 image to GitHub Container Registry (GHCR) using `GITHUB_TOKEN`.

To run a published image, set `DASHBOARD_IMAGE=ghcr.io/OWNER/REPOSITORY:main` in a local `.env` file and run `docker compose pull` followed by `docker compose up -d`. GHCR packages may require `docker login ghcr.io` if the package is private.

This pipeline publishes a deployable image; it does not deploy to a remote host because no deployment target or credentials are configured.
