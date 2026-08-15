(function () {
  const burger = document.getElementById("nav-burger");
  const drawer = document.getElementById("nav-drawer");
  const backdrop = document.getElementById("nav-backdrop");
  if (!burger || !drawer) return;

  let lastFocus = null;

  function getFocusable() {
    return Array.from(
      drawer.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  }

  function openMenu() {
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

    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    } else {
      burger.focus();
    }
  }

  function toggle() {
    if (drawer.hidden) openMenu();
    else closeMenu();
  }

  burger.addEventListener("click", toggle);
  if (backdrop) backdrop.addEventListener("click", closeMenu);
  drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));

  window.addEventListener("keydown", (e) => {
    if (drawer.hidden) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }

    // Focus trap
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

  drawer.setAttribute("aria-hidden", drawer.hidden ? "true" : "false");
  if (backdrop) backdrop.setAttribute("aria-hidden", "true");
})();
