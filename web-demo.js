(function () {
  "use strict";

  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
  const isWebDemo = new URLSearchParams(location.search).has("demo")
    || location.protocol === "https:"
    || !localHosts.has(location.hostname);
  window.DASH_WEB_DEMO = isWebDemo;

  if (!isWebDemo) return;

  document.documentElement.classList.add("web-demo");
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-section="work"], [data-section="quotes"]').forEach(link => {
      link.hidden = true;
      link.setAttribute("aria-hidden", "true");
    });

    const source = document.querySelector(".source-status");
    if (source) source.title = "Versão web de demonstração";
  });
})();
