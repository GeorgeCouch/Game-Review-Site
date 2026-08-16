(function () {
  let pendingBtn = null;
  const modal = document.getElementById("report-modal");

  function openModal(btn) {
    pendingBtn = btn;
    if (!modal) {
      // fallback if modal missing
      submitReport(btn);
      return;
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("gc-modal-open");
    modal.classList.remove("is-closing");
    void modal.offsetWidth;
    modal.classList.add("is-open");
  }

  function closeModal() {
    if (!modal || modal.hidden) {
      pendingBtn = null;
      return;
    }
    modal.classList.remove("is-open");
    modal.classList.add("is-closing");
    const done = () => {
      modal.hidden = true;
      modal.classList.remove("is-closing");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("gc-modal-open");
      modal.removeEventListener("animationend", done);
      pendingBtn = null;
    };
    modal.addEventListener("animationend", done);
    setTimeout(done, 220);
  }

  async function submitReport(btn) {
    if (!btn || btn.dataset.busy === "1") return;
    if (btn.dataset.reported === "1") return;

    btn.dataset.busy = "1";
    btn.classList.add("reported");
    btn.dataset.reported = "1";
    btn.title = "Reported";

    try {
      const res = await fetch("/report", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          target_type: btn.dataset.targetType || "review",
          target_id: btn.dataset.targetId,
          reason: "Reported review",
        }),
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        btn.classList.remove("reported");
        btn.dataset.reported = "0";
        btn.title = "Report review";
      }
    } catch (err) {
      btn.classList.remove("reported");
      btn.dataset.reported = "0";
      btn.title = "Report review";
    } finally {
      btn.dataset.busy = "0";
    }
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".report-btn");
    if (btn) {
      e.preventDefault();
      if (btn.dataset.reported === "1") return;
      openModal(btn);
      return;
    }

    if (e.target.closest("[data-close-report-modal]")) {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.target.closest("#report-confirm-btn")) {
      e.preventDefault();
      const target = pendingBtn;
      closeModal();
      if (target) submitReport(target);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeModal();
  });
})();
