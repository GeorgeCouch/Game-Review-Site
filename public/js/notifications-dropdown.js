(function () {
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setBadge(n) {
    var count = Number(n) || 0;
    document.querySelectorAll(".notif-badge").forEach(function (b) {
      if (count > 0) {
        b.hidden = false;
        b.removeAttribute("hidden");
        b.textContent = count > 9 ? "9+" : String(count);
        b.style.display = "";
      } else {
        b.hidden = true;
        b.setAttribute("hidden", "");
        b.textContent = "";
        b.style.display = "none";
      }
    });
  }

  function hrefFor(n) {
    if (n.type === "like" || n.type === "comment") {
      return n.entity_id ? "/review/" + n.entity_id : n.actor_username ? "/u/" + n.actor_username : "#";
    }
    if (n.type === "follow") return n.actor_username ? "/u/" + n.actor_username : "#";
    return n.actor_username ? "/u/" + n.actor_username : "#";
  }

  function textFor(n) {
    var name = n.actor_display_name || n.actor_username || "Someone";
    if (n.type === "like") return "<strong>" + escapeHtml(name) + "</strong> liked your review" + (n.message ? " of " + escapeHtml(n.message) : "");
    if (n.type === "follow") return "<strong>" + escapeHtml(name) + "</strong> followed you";
    if (n.type === "comment") return "<strong>" + escapeHtml(name) + "</strong> commented on your review" + (n.message ? " of " + escapeHtml(n.message) : "");
    return "<strong>" + escapeHtml(name) + "</strong> " + escapeHtml(n.message || "interacted with you");
  }

  function when(n) {
    if (!n.created_at) return "";
    try {
      return new Date(n.created_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function setup(menu) {
    var btn = menu.querySelector(".notif-nav");
    var dropdown = menu.querySelector(".nav-notif-dropdown");
    var list = menu.querySelector(".nav-notif-list");
    var clearBtn = menu.querySelector(".nav-notif-clear");
    if (!btn || !dropdown || !list) return;

    function render(items) {
      if (!items.length) {
        list.innerHTML = '<div class="nav-notif-empty">You’re all caught up</div>';
        return;
      }
      list.innerHTML = items
        .map(function (n) {
          var avatar = n.actor_avatar
            ? '<img src="' + escapeHtml(n.actor_avatar) + '" alt="" class="notif-avatar" />'
            : '<div class="notif-avatar notif-avatar-placeholder">' +
              escapeHtml((n.actor_display_name || n.actor_username || "?").charAt(0).toUpperCase()) +
              "</div>";
          return (
            '<a href="' + escapeHtml(hrefFor(n)) + '" class="notif-item nav-notif-item' + (n.read ? "" : " unread") + '" data-id="' + n.id + '">' +
            avatar +
            '<div class="notif-body"><div class="notif-text">' + textFor(n) + '</div><div class="notif-time">' + escapeHtml(when(n)) + "</div></div></a>"
          );
        })
        .join("");
    }

    async function load() {
      list.innerHTML = '<div class="nav-notif-empty">Loading…</div>';
      try {
        var res = await fetch("/api/notifications", { headers: { Accept: "application/json" } });
        var data = await res.json();
        if (!res.ok || !data.ok) {
          list.innerHTML = '<div class="nav-notif-empty">Could not load notifications</div>';
          return;
        }
        render(data.notifications || []);
        setBadge(data.unread || 0);
      } catch (e) {
        list.innerHTML = '<div class="nav-notif-empty">Could not load notifications</div>';
      }
    }

    function open() {
      document.querySelectorAll(".nav-notif-menu").forEach(function (m) {
        if (m !== menu) {
          var d = m.querySelector(".nav-notif-dropdown");
          var b = m.querySelector(".notif-nav");
          if (d) d.hidden = true;
          if (b) b.setAttribute("aria-expanded", "false");
          m.classList.remove("is-open");
        }
      });
      dropdown.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      menu.classList.add("is-open");
      load();
    }

    function close() {
      dropdown.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      menu.classList.remove("is-open");
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (dropdown.hidden) open();
      else close();
    });

    list.addEventListener("click", async function (e) {
      var item = e.target.closest(".nav-notif-item");
      if (!item) return;
      var id = item.getAttribute("data-id");
      if (!id) return;
      try {
        var res = await fetch("/api/notifications/" + id + "/read", {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        var data = await res.json();
        if (data && typeof data.unread === "number") setBadge(data.unread);
        item.classList.remove("unread");
      } catch (err) {}
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
          var res = await fetch("/api/notifications/clear-all", {
            method: "POST",
            headers: { Accept: "application/json" },
          });
          var data = await res.json();
          if (data.ok) {
            render([]);
            setBadge(0);
          }
        } catch (err) {}
      });
    }

    document.addEventListener("click", function (e) {
      if (!menu.contains(e.target)) close();
    });
  }

  document.querySelectorAll(".nav-notif-menu").forEach(setup);
})();
