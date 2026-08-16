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
    if (!burger || !drawer || drawer.hidden) return;
    drawer.classList.add("is-closing");
    if (backdrop) backdrop.classList.add("is-closing");
    const finish = () => {
      drawer.hidden = true;
      drawer.classList.remove("is-closing");
      drawer.setAttribute("aria-hidden", "true");
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.classList.remove("is-closing");
        backdrop.setAttribute("aria-hidden", "true");
      }
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", "Open menu");
      burger.classList.remove("is-open");
      document.body.classList.remove("nav-open");
      drawer.removeEventListener("animationend", finish);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      else burger.focus();
    };
    drawer.addEventListener("animationend", finish);
    setTimeout(finish, 200);
  }

  if (burger && drawer) {
    burger.addEventListener("click", (e) => {
      e.stopPropagation();
      drawer.hidden ? openMenu() : closeMenu();
    });
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      });
    }
    // Clicks inside the panel should not close the menu (except real navigation links)
    drawer.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    drawer.querySelectorAll("a[href]").forEach((a) => {
      a.addEventListener("click", () => {
        // allow navigation, then close
        closeMenu();
      });
    });
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

(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wireSearch(inputId, resultsId) {
    const input = document.getElementById(inputId);
    const resultsEl = document.getElementById(resultsId);
    if (!input || !resultsEl) return;

    let timer = null;
    let seq = 0;

    function hide() {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
    }

    function show() {
      resultsEl.hidden = false;
    }

    async function run(q) {
      const my = ++seq;
      if (q.length < 2) {
        hide();
        return;
      }
      resultsEl.innerHTML = '<div class="nav-search-status">Searching…</div>';
      show();
      try {
        const [gamesRes, usersRes] = await Promise.all([
          fetch("/api/games/search?q=" + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({ results: [] })),
          fetch("/api/users/search?q=" + encodeURIComponent(q)).then((r) => r.json()).catch(() => ({ results: [] })),
        ]);
        if (my !== seq) return;

        const games = gamesRes.results || gamesRes.games || [];
        const users = usersRes.results || usersRes.users || [];

        let html = "";
        if (users.length) {
          html += '<div class="nav-search-group">People</div>';
          html += users.slice(0, 5).map((u) => {
            const name = escapeHtml(u.display_name || u.username || "User");
            const handle = escapeHtml(u.username || "");
            const avatar = u.avatar_url
              ? '<img src="' + escapeHtml(u.avatar_url) + '" alt="" />'
              : '<span class="nav-search-fallback">' + name.charAt(0).toUpperCase() + "</span>";
            return (
              '<a class="nav-search-item" role="option" href="/u/' + handle + '">' +
              '<span class="nav-search-thumb nav-search-thumb-user">' + avatar + "</span>" +
              '<span class="nav-search-text"><span class="nav-search-title">' + name + '</span>' +
              '<span class="nav-search-sub">@' + handle + "</span></span></a>"
            );
          }).join("");
        }
        if (games.length) {
          html += '<div class="nav-search-group">Games</div>';
          html += games.slice(0, 8).map((g) => {
            const name = escapeHtml(g.name || g.title || "Game");
            const id = g.id || g.game_id;
            const cover = g.cover || g.cover_url;
            const year = g.released ? new Date(g.released).getFullYear() : "";
            const thumb = cover
              ? '<img src="' + escapeHtml(cover) + '" alt="" />'
              : '<span class="nav-search-fallback">' + name.charAt(0).toUpperCase() + "</span>";
            return (
              '<a class="nav-search-item" role="option" href="/game/' + id + '">' +
              '<span class="nav-search-thumb">' + thumb + "</span>" +
              '<span class="nav-search-text"><span class="nav-search-title">' + name + "</span>" +
              (year ? '<span class="nav-search-sub">' + year + "</span>" : "") +
              "</span></a>"
            );
          }).join("");
        }
        if (!html) {
          html = '<div class="nav-search-status">No results</div>';
        }
        resultsEl.innerHTML = html;
        show();
      } catch (err) {
        if (my !== seq) return;
        resultsEl.innerHTML = '<div class="nav-search-status">Search failed</div>';
        show();
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      timer = setTimeout(() => run(q), 250);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hide();
        input.blur();
      }
    });

    document.addEventListener("click", (e) => {
      const wrap = input.closest(".nav-search-wrap");
      if (wrap && !wrap.contains(e.target)) hide();
    });
  }

  wireSearch("nav-search-input", "nav-search-results");
  wireSearch("nav-search-input-mobile", "nav-search-results-mobile");
})();


  // Profile dropdown
  const profileBtn = document.getElementById("nav-profile-btn");
  const profileMenu = document.getElementById("nav-profile-dropdown");
  if (profileBtn && profileMenu) {
    function closeProfile() {
      profileMenu.hidden = true;
      profileBtn.setAttribute("aria-expanded", "false");
    }
    function openProfile() {
      profileMenu.hidden = false;
      profileBtn.setAttribute("aria-expanded", "true");
    }
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (profileMenu.hidden) openProfile();
      else closeProfile();
    });
    document.addEventListener("click", (e) => {
      const wrap = document.getElementById("nav-profile-menu");
      if (wrap && !wrap.contains(e.target)) closeProfile();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeProfile();
    });
  }


  // Theme toggle — sun/moon switch, no page reload
  (function () {
    const root = document.documentElement;
    const metaTheme = document.getElementById("meta-theme-color");

    function currentTheme() {
      return root.getAttribute("data-theme") === "light" ? "light" : "dark";
    }

    function syncSwitches(theme) {
      document.querySelectorAll(".theme-switch").forEach((el) => {
        el.classList.toggle("is-light", theme === "light");
        el.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
      });
    }

    function applyTheme(theme, { persist = true } = {}) {
      const t = theme === "light" ? "light" : "dark";
      root.setAttribute("data-theme", t);
      root.style.colorScheme = t;
      if (persist) {
        try { localStorage.setItem("gc-theme", t); } catch (e) {}
      }
      if (metaTheme) metaTheme.setAttribute("content", t === "light" ? "#f4f6fb" : "#0b0d12");
      syncSwitches(t);
    }

    function toggleTheme(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      applyTheme(currentTheme() === "light" ? "dark" : "light");
    }

    applyTheme(currentTheme(), { persist: false });

    document.querySelectorAll("#nav-theme-toggle, #nav-theme-toggle-mobile, #nav-theme-toggle-mobile-guest").forEach((el) => {
      el.addEventListener("click", toggleTheme);
    });
  })();

(function loadNotifDropdown() {
  if (!document.querySelector(".nav-notif-menu")) return;
  var s = document.createElement("script");
  s.src = "/js/notifications-dropdown.js";
  document.body.appendChild(s);
})();
