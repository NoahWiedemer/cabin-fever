// Shared GLB loading: one GLTFLoader (meshopt-enabled), cached by URL. preloadGLBs() is awaited
// during Game.load so gameplay code can fetch parsed assets synchronously with getGLB().
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map(); // url -> Promise<gltf | null>
const ready = new Map(); // url -> gltf (resolved, non-null)

export function loadGLB(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      loader.loadAsync(url).then(
        (gltf) => {
          ready.set(url, gltf);
          return gltf;
        },
        (err) => {
          console.warn('GLB failed to load', url, err);
          return null;
        }
      )
    );
  }
  return cache.get(url);
}

/** Load several GLBs in parallel; progress(fraction) after each one. Failures resolve to null. */
export async function preloadGLBs(urls, progress) {
  let done = 0;
  await Promise.all(
    urls.map((u) =>
      loadGLB(u).then(() => {
        done++;
        progress?.(done / urls.length);
      })
    )
  );
}

/** The parsed glTF for a preloaded URL, or null if it is missing or failed. */
export function getGLB(url) {
  return ready.get(url) ?? null;
}
