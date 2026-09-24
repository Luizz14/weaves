// Desktop bundle entry for the host-service worker thread. Emitted as
// dist/main/host-worker.cjs, side-by-side with host-service.cjs so the pool's
// script resolution finds it (see host-worker-pool.ts).
import "@superset/host-service/host-worker";
