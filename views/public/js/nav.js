(function () {
  const burger = document.getElementById("nav-burger");
  const drawer = document.getElementById("nav-drawer");
  const backdrop = document.getElementById("nav-backdrop");

  let lastFocus = null;

  function getFocusable() {
    if (!drawer) return [];
    return Array.from(
      drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);
  }

  function openMenu() {
    if (!burger || !drawer) return;
    lastFocus = document.activeElement;
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.setAttribute("aria-hidden", "false");
    }
    burger.setAttribute("aria-expanded", "true");
    burger.setAttribute("aria-label", "Close menu");
    burger.classList.add("is-open");
    document.body.classList.add("nav-open");
    const focusable = getFocusable();
    if (focusable.length) focusable[0].focus();
  }

  function closeMenu() {
    if (!burger || !drawer) return;
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.setAttribute("aria-hidden", "true");
    }
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Open menu");
    burger.classList.remove("is-open");
    document.body.classList.remove("nav-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    else burger.focus();
  }

  if (burger && drawer) {
    burger.addEventListener("click", () => (drawer.hidden ? openMenu() : closeMenu()));
    if (backdrop) backdrop.addEventListener("click", closeMenu);
    drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
    window.addEventListener("keydown", (e) => {
      if (drawer.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    drawer.setAttribute("aria-hidden", "true");
  }

  // Sort menu (no Bootstrap)
  const sortBtn = document.getElementById("sort-menu-btn");
  const sortMenu = document.getElementById("sort-menu");
  if (sortBtn && sortMenu) {
    function closeSort() {
      sortMenu.classList.add("hidden");
      sortMenu.hidden = true;
      sortBtn.setAttribute("aria-expanded", "false");
    }
    function openSort() {
      sortMenu.classList.remove("hidden");
      sortMenu.hidden = false;
      sortBtn.setAttribute("aria-expanded", "true");
    }
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sortMenu.hidden) openSort();
      else closeSort();
    });
    document.addEventListener("click", (e) => {
      if (!sortMenu.hidden && !sortMenu.contains(e.target) && e.target !== sortBtn) closeSort();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSort();
    });
  }

  // PWA
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
