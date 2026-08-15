document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".follow-btn");
  if (!btn) return;

  e.preventDefault();
  const username = btn.dataset.username;
  if (!username) return;

  const following = btn.dataset.following === "1";
  const url = following ? `/unfollow/${username}` : `/follow/${username}`;

  btn.disabled = true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Something went wrong");
      btn.disabled = false;
      return;
    }

    const nowFollowing = !!data.following;
    btn.dataset.following = nowFollowing ? "1" : "0";
    btn.textContent = nowFollowing ? "Unfollow" : "Follow";
    btn.classList.toggle("nav-btn-primary", !nowFollowing);

    // Update follower count if present
    if (typeof data.followerCount === "number") {
      const el = document.querySelector("[data-follower-count]");
      if (el) el.textContent = data.followerCount;
    }
  } catch (err) {
    alert("Network error");
  }
  btn.disabled = false;
});
