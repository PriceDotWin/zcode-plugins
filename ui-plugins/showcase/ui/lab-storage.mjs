const KEY = "zcode.showcase.lab.sample.v1";
const DATABASE = "zcode-showcase-lab-v1";

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("samples");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Showcase storage upgrade blocked by another page"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function stored(action, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("samples", action === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("samples");
      const request =
        action === "read"
          ? store.get(KEY)
          : action === "write"
            ? store.put(value, KEY)
            : store.delete(KEY);
      // 等事务提交再显示成功，request.onsuccess 不表示写事务已完成。
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export function mountStorage({ observe }) {
  for (const action of ["read", "write", "delete"]) {
    document.getElementById(`storage-${action}`).addEventListener("click", async () => {
      const buttons = [...document.querySelectorAll("#storage button")];
      buttons.forEach((button) => {
        button.disabled = true;
      });
      const output = document.getElementById("storage-result");
      output.dataset.phase = "running";
      try {
        const value = document.getElementById("storage-value").value;
        if (action === "write") localStorage.setItem(KEY, value);
        if (action === "delete") localStorage.removeItem(KEY);
        await stored(action, value);
        const result = { localStorage: localStorage.getItem(KEY), indexedDB: await stored("read") };
        output.textContent = JSON.stringify(result, null, 2);
        output.dataset.phase = "complete";
        observe(`storage/${action}`, result);
      } catch (error) {
        output.textContent = error.message;
        output.dataset.phase = "error";
        observe(`storage/${action}`, {
          error: error.message,
          partialWritePossible: action !== "read",
        });
      } finally {
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    });
  }
}
