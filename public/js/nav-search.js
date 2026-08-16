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
