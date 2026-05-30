// Notifications — toast messages and error display.
// Dependencies: DOM (errorArea)

let nextToastId = 1;
let activeToastTimers = new Map();

function showToast(message, tone = "error") {
  if (!errorArea) {
    return;
  }

  const toastId = nextToastId;
  nextToastId += 1;

  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.dataset.tone = String(tone || "error");
  toast.dataset.toastId = String(toastId);
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.textContent = String(message || "An unexpected event occurred.");
  errorArea.appendChild(toast);

  while (errorArea.childElementCount > 4) {
    const oldestToast = errorArea.firstElementChild;
    if (!(oldestToast instanceof HTMLElement)) {
      break;
    }
    const oldestId = Number(oldestToast.dataset.toastId || 0);
    const oldestTimer = activeToastTimers.get(oldestId);
    if (oldestTimer) {
      window.clearTimeout(oldestTimer);
      activeToastTimers.delete(oldestId);
    }
    oldestToast.remove();
  }

  const timerId = window.setTimeout(() => {
    toast.remove();
    activeToastTimers.delete(toastId);
  }, 5000);
  activeToastTimers.set(toastId, timerId);
}

function clearToastRegion() {
  activeToastTimers.forEach((timerId) => window.clearTimeout(timerId));
  activeToastTimers.clear();
  if (errorArea) {
    errorArea.replaceChildren();
  }
}

function showError(message) {
  showToast(message, "error");
}
