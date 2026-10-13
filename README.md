# ModelKiln

A local-first dashboard for Ollama model status, GPU telemetry, and inference activity routed through its proxy. It does not hardcode or upload a machine name, username, hardware inventory, or model prompts.

## Quick Start: Docker

Requirements: Git, Docker Desktop (Windows/macOS) or Docker Engine with Compose (Linux), and Ollama installed on the host. Ollama must have at least one model pulled; for example, `ollama pull qwen2.5-coder:3b`.

Clone the repository, enter the folder, and start the dashboard with one command:

```sh
git clone https://github.com/rvsshuklavinod18/modelkiln.git
cd modelkiln
docker compose up --build -d
```

Open `http://127.0.0.1:3210`. The Compose port is bound to loopback, and activity metadata persists in a named Docker volume. Stop the dashboard with `docker compose down`; remove its activity volume too with `docker compose down -v`.

The published Linux AMD64 image is `ghcr.io/rvsshuklavinod18/modelkiln:main`. To use it instead of building from the clone, set `DASHBOARD_IMAGE=ghcr.io/rvsshuklavinod18/modelkiln:main`, run `docker compose pull`, then `docker compose up -d --no-build`.

### Ollama Connection Notes

The container connects to host Ollama at `http://host.docker.internal:11434`. Docker Desktop provides this hostname on Windows and macOS; Compose adds a host-gateway mapping for Linux. Host firewalls or Ollama's bind address may still block container-to-host requests. If Ollama is not reachable, keep the dashboard local and configure Ollama/firewall access only for the Docker host network; do not expose port 11434 to the public internet.

The container cannot uninstall the host Ollama app. Use `docker compose down` to remove the dashboard. GPU telemetry may be unavailable in the Linux container, especially when Ollama itself runs on Windows; model status and dashboard controls remain available when Ollama is reachable.

## Native Run: Windows, macOS, or Linux

Requirements: Node.js 20.19+ (or 22.12+) and Ollama. Install Ollama using the official installer for your operating system, then clone the repository. From the project folder run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. On Windows, `OLLAMA_GPU_OVERHEAD` and `OLLAMA_KEEP_ALIVE` can be set as user environment variables. On macOS/Linux, export those variables before starting Ollama and restart its service/app for the settings to take effect. `OLLAMA_GPU_OVERHEAD` reserves VRAM in Ollama's scheduler; it is not a hard hardware-enforced cap.

GPU telemetry uses `nvidia-smi` when available. The GPU name and current metrics are queried locally at runtime and are not written to the repository or activity log. Non-NVIDIA systems still get Ollama model and activity monitoring, but may show GPU telemetry as unavailable. Fan RPM depends on hardware/driver support.

## Connect Coding Agents

Only inference requests sent through the dashboard proxy appear in the ledger. In Cline, select the Ollama provider and set its base URL to `http://127.0.0.1:3210/ollama`. Configure Continue's Ollama provider with the same URL. Select a model installed on the user's own Ollama instance.

The ledger stores request metadata (model, endpoint, status, and duration), not prompt or response text. Agent file edits remain in the agent's own task history. Requests sent directly to `http://127.0.0.1:11434` bypass the ledger.

## Privacy and Controls

The dashboard binds to loopback by default. Activity metadata is stored locally in `data/activity.jsonl` (native) or the `dashboard-data` Docker volume. It is excluded from Git. No telemetry is sent to this repository or GitHub.

- **Stop** unloads a model and releases its VRAM.
- **Remove model** deletes that model's local files after confirmation.
- **Uninstall Ollama** is available in the native Windows app only. It uses WinGet after confirmation and preserves model files unless explicitly selected.

## Development and CI

Run `npm test`, `npm run lint`, and `npm run build` from the project folder. GitHub Actions runs these checks, builds and smoke-tests the Docker image, and publishes `linux/amd64` images to GHCR on pushes to `main` and version tags. The pipeline publishes the image but does not deploy it to a remote host.
