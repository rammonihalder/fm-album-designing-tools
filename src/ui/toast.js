"use strict";

function createToastManager(toastElement, defaultDuration = 3000) {
  let timer = null;

  function show(message, type = "info", duration = defaultDuration) {
    if (!toastElement) return;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    toastElement.textContent = message;
    toastElement.className = `toast ${type}`;
    toastElement.hidden = false;

    timer = setTimeout(() => {
      dismiss();
    }, duration);
  }

  function dismiss() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (toastElement) {
      toastElement.hidden = true;
      toastElement.textContent = "";
      toastElement.className = "toast";
    }
  }

  function getTimer() {
    return timer;
  }

  return {
    show,
    dismiss,
    getTimer
  };
}

module.exports = {
  createToastManager
};
