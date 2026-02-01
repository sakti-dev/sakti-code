import { createSignal } from "solid-js";

export default function App() {
  const [count, setCount] = createSignal(0);

  return (
    <div class="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-gray-900 text-white">
      <h1 class="text-4xl font-bold">ekacode</h1>
      <p class="text-xl text-gray-300">Phase 0 Foundation Complete</p>

      <div class="card rounded-lg bg-gray-800 p-6">
        <button
          class="rounded bg-blue-600 px-4 py-2 font-medium transition-colors hover:bg-blue-700"
          onClick={() => setCount(c => c + 1)}
        >
          count is {count()}
        </button>
        <p class="mt-4 text-sm text-gray-400">
          Edit <code>src/renderer/src/App.tsx</code> and save to test HMR
        </p>
      </div>

      <div class="mt-8 text-sm text-gray-500">
        <button
          class="text-blue-400 hover:text-blue-300"
          onClick={() => window.electron.ipcRenderer?.send("ping")}
        >
          Send IPC
        </button>
      </div>
    </div>
  );
}
