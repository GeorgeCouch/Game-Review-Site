(function () {
  const heartPath =
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

  function updateButton(btn, liked, count) {
    btn.dataset.liked = liked ? "1" : "0";
    btn.title = liked ? "Unlike" : "Like";
    btn.classList.toggle("liked", liked);

    const svg = btn.querySelector("svg");
    if (svg) {
      svg.setAttribute("fill", liked ? "currentColor" : "none");
    }

    const reviewId = btn.dataset.reviewId;
    const countEl = document.querySelector(
      '.like-count[data-review-id="' + reviewId + '"]'
    );
    if (countEl && typeof count === "number") {
      countEl.textContent = count;
    }
  }

  async function toggleLike(btn) {
    if (btn.dataset.busy === "1") return;
    const reviewId = btn.dataset.reviewId;
    const currentlyLiked = btn.dataset.liked === "1";
    const url = currentlyLiked ? "/unlike/" + reviewId : "/like/" + reviewId;

    btn.dataset.busy = "1";
    btn.disabled = true;

    // Optimistic UI
    const countEl = document.querySelector(
      '.like-count[data-review-id="' + reviewId + '"]'
    );
    const prevCount = countEl ? parseInt(countEl.textContent, 10) || 0 : 0;
    updateButton(btn, !currentlyLiked, currentlyLiked ? Math.max(0, prevCount - 1) : prevCount + 1);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!res.ok) {
        // Revert optimistic update
        updateButton(btn, currentlyLiked, prevCount);
        return;
      }

      const data = await res.json();
      updateButton(btn, data.liked, data.count);
    } catch (err) {
      updateButton(btn, currentlyLiked, prevCount);
    } finally {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".like-btn");
    if (!btn) return;
    e.preventDefault();
    toggleLike(btn);
  });
})();
