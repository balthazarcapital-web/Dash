(function () {
  "use strict";

  const version = "1.1.6";
  window.DASH_VERSION = version;

  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
  const isWebDemo = new URLSearchParams(location.search).has("demo")
    || location.protocol === "https:"
    || !localHosts.has(location.hostname);
  window.DASH_WEB_DEMO = isWebDemo;

  if (!isWebDemo) return;

  document.documentElement.classList.add("web-demo");
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-dash-version]").forEach(node => {
      node.textContent = `v${version}`;
    });

    const source = document.querySelector(".source-status");
    if (source) source.title = "Versão web de demonstração";
  });
})();
