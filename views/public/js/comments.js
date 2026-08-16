(function () {
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString();
    } catch (e) {
      return "";
    }
  }

  function updateCount(section, delta) {
    const el = section.querySelector(".comment-count");
    if (!el) return;
    const n = Math.max(0, (parseInt(el.textContent, 10) || 0) + delta);
    el.textContent = n;
  }

  function buildCommentEl(c) {
    const author = c.author_display_name || c.author_username || "You";
    const authorHtml = c.author_username
      ? `<a href="/u/${esc(c.author_username)}" style="color: var(--accent);">${esc(author)}</a>`
      : esc(author);

    const div = document.createElement("div");
    div.className = "comment";
    div.id = "comment-" + c.id;
    div.dataset.commentId = c.id;
    div.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${authorHtml}</span>
        <span class="comment-date">${esc(formatDate(c.created_at))}</span>
      </div>
      ${
        c.has_spoilers
          ? `<div class="spoiler-block spoiler-block-sm" data-spoiler>
              <div class="spoiler-badge">Spoilers</div>
              <p class="comment-body spoiler-content is-hidden" id="comment-body-${c.id}">${esc(c.content)}</p>
              <button type="button" class="spoiler-reveal nav-btn">Show</button>
            </div>`
          : `<p class="comment-body" id="comment-body-${c.id}">${esc(c.content)}</p>`
      }
      <div class="comment-actions">
        <button type="button" class="comment-action-btn js-edit-comment">Edit</button>
        <button type="button" class="comment-action-btn danger js-delete-comment">Delete</button>
      </div>
      <form class="edit-comment-form" id="edit-form-${c.id}" style="display:none;">
        <input type="hidden" name="comment_id" value="${c.id}" />
        <textarea name="content" class="form-control comment-edit-input" rows="2" required>${esc(c.content)}</textarea>
        <div class="edit-comment-btns">
          <button type="submit" class="nav-btn nav-btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;">Save</button>
          <button type="button" class="nav-btn js-cancel-edit" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;">Cancel</button>
        </div>
      </form>`;
    return div;
  }

  async function postForm(url, data) {
    const body = new URLSearchParams(data);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  // Add comment
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".add-comment-form");
    if (!form) return;
    e.preventDefault();

    const reviewId = form.dataset.reviewId || form.querySelector('[name="review_id"]').value;
    const textarea = form.querySelector('[name="content"]');
    const content = (textarea.value || "").trim();
    if (!content) return;
    const spoilerCb = form.querySelector('[name="has_spoilers"]');
    const has_spoilers = spoilerCb && spoilerCb.checked ? "1" : "";

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    try {
      const data = await postForm("/comment", { review_id: reviewId, content, has_spoilers });
      const section = form.closest(".comments-section");
      let list = section.querySelector(".comments-list");
      if (!list) {
        list = document.createElement("div");
        list.className = "comments-list";
        section.insertBefore(list, form);
      }
      list.appendChild(buildCommentEl(data.comment));
      updateCount(section, 1);
      textarea.value = "";
      if (spoilerCb) spoilerCb.checked = false;
    } catch (err) {
      alert(err.message || "Could not post comment");
    }
    if (btn) btn.disabled = false;
  });

  // Edit / delete / cancel
  document.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".js-edit-comment");
    if (editBtn) {
      const comment = editBtn.closest(".comment");
      const id = comment.dataset.commentId;
      const body = document.getElementById("comment-body-" + id);
      const form = document.getElementById("edit-form-" + id);
      if (body) body.style.display = "none";
      if (form) form.style.display = "block";
      return;
    }

    const cancelBtn = e.target.closest(".js-cancel-edit");
    if (cancelBtn) {
      const comment = cancelBtn.closest(".comment");
      const id = comment.dataset.commentId;
      const body = document.getElementById("comment-body-" + id);
      const form = document.getElementById("edit-form-" + id);
      if (body) body.style.display = "block";
      if (form) form.style.display = "none";
      return;
    }

    const delBtn = e.target.closest(".js-delete-comment");
    if (delBtn) {
      if (!confirm("Delete this comment?")) return;
      const comment = delBtn.closest(".comment");
      const id = comment.dataset.commentId;
      const section = comment.closest(".comments-section");
      try {
        await postForm("/delete-comment", { comment_id: id });
        comment.remove();
        if (section) updateCount(section, -1);
      } catch (err) {
        alert(err.message || "Could not delete");
      }
    }
  });

  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".edit-comment-form");
    if (!form) return;
    e.preventDefault();
    const commentId = form.querySelector('[name="comment_id"]').value;
    const content = (form.querySelector('[name="content"]').value || "").trim();
    if (!content) return;
    try {
      const data = await postForm("/edit-comment", {
        comment_id: commentId,
        content,
      });
      const body = document.getElementById("comment-body-" + commentId);
      if (body) {
        body.textContent = data.comment.content;
        body.style.display = "block";
      }
      form.style.display = "none";
    } catch (err) {
      alert(err.message || "Could not save");
    }
  });
})();

  // Spoiler reveal
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".spoiler-reveal");
    if (!btn) return;
    const block = btn.closest("[data-spoiler]");
    if (!block) return;
    block.querySelectorAll(".spoiler-content").forEach((el) => el.classList.remove("is-hidden"));
    btn.remove();
  });
