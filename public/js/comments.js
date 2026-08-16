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

  function setCommentEditing(commentEl, editing) {
    if (!commentEl) return;
    commentEl.classList.toggle("is-editing", !!editing);
    const actions = commentEl.querySelector(".comment-actions");
    const body = commentEl.querySelector(".comment-body");
    const spoilerBlock = commentEl.querySelector("[data-spoiler]");
    const form = commentEl.querySelector(".edit-comment-form");
    if (actions) {
      actions.hidden = !!editing;
      if (editing) actions.style.setProperty("display", "none", "important");
      else actions.style.removeProperty("display");
    }
    if (form) form.style.display = editing ? "block" : "none";
    // Always clear inline hides so Cancel restores the original text
    if (body) body.style.removeProperty("display");
    if (spoilerBlock) spoilerBlock.style.removeProperty("display");
  }

  function renderCommentBody(commentEl, content, hasSpoilers) {
    const id = commentEl.dataset.commentId;
    let row = commentEl.querySelector(".comment-body-row");
    const actions = commentEl.querySelector(".comment-actions");
    const form = commentEl.querySelector(".edit-comment-form");
    if (!row) {
      row = document.createElement("div");
      row.className = "comment-body-row";
      if (actions) commentEl.insertBefore(row, actions);
      else if (form) commentEl.insertBefore(row, form);
      else commentEl.appendChild(row);
      if (actions) row.appendChild(actions);
    }
    row.querySelectorAll(".comment-body, [data-spoiler]").forEach((el) => el.remove());
    let html = "";
    if (hasSpoilers) {
      html = `<div class="spoiler-block spoiler-block-sm" data-spoiler>
        <div class="spoiler-toolbar">
          <button type="button" class="spoiler-reveal spoiler-chip">Show Spoilers</button>
        </div>
        <p class="comment-body spoiler-content is-hidden" id="comment-body-${id}">${esc(content)}</p>
      </div>`;
    } else {
      html = `<p class="comment-body" id="comment-body-${id}">${esc(content)}</p>`;
    }
    row.insertAdjacentHTML("afterbegin", html);
  }

  function buildCommentEl(c) {
    const author = c.author_display_name || c.author_username || "You";
    const authorHtml = c.author_username
      ? `<a href="/u/${esc(c.author_username)}" style="color: var(--accent);">${esc(author)}</a>`
      : esc(author);
    const reviewId = c.review_id || "";
    const parentId = c.parent_id || "";

    const div = document.createElement("div");
    div.className = "comment comment-thread-node";
    div.id = "comment-" + c.id;
    div.dataset.commentId = c.id;
    if (parentId) div.dataset.parentId = parentId;
    div.innerHTML = `
      <div class="comment-main">
        <div class="comment-meta">
          <span class="comment-author">${authorHtml} <span class="you-badge you-badge-sm">You</span></span>
          <span class="comment-date">${esc(formatDate(c.created_at))}</span>
        </div>
        <div class="comment-body-row">
        ${
          c.has_spoilers
            ? `<div class="spoiler-block spoiler-block-sm" data-spoiler>
                <div class="spoiler-toolbar">
                  <button type="button" class="spoiler-reveal spoiler-chip">Show Spoilers</button>
                </div>
                <p class="comment-body spoiler-content is-hidden" id="comment-body-${c.id}">${esc(c.content)}</p>
              </div>`
            : `<p class="comment-body" id="comment-body-${c.id}">${esc(c.content)}</p>`
        }
          </div>
        <div class="comment-footer-actions">
          <button type="button" class="comment-reply-btn js-reply-comment">Reply</button>
          <div class="comment-actions comment-actions-end">
            <button type="button" class="comment-icon-btn js-edit-comment" title="Edit comment">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="comment-icon-btn danger js-delete-comment" title="Delete comment">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
        <form class="edit-comment-form" id="edit-form-${c.id}" style="display:none;">
          <input type="hidden" name="comment_id" value="${c.id}" />
          <textarea name="content" class="form-control comment-edit-input" rows="2" required>${esc(c.content)}</textarea>
          <div class="edit-comment-footer">
            <label class="spoiler-toggle">
              <input type="checkbox" name="has_spoilers" value="1" ${c.has_spoilers ? "checked" : ""} />
              <span class="spoiler-toggle-ui" aria-hidden="true"></span>
              <span class="spoiler-toggle-label">Spoilers</span>
            </label>
            <div class="edit-comment-btns">
              <button type="submit" class="nav-btn nav-btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;">Save</button>
              <button type="button" class="nav-btn js-cancel-edit" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;">Cancel</button>
            </div>
          </div>
        </form>
        <form class="reply-comment-form" data-parent-id="${c.id}" data-review-id="${reviewId}" style="display:none;">
          <input type="hidden" name="review_id" value="${reviewId}" />
          <input type="hidden" name="parent_id" value="${c.id}" />
          <textarea name="content" class="form-control comment-input" rows="2" placeholder="Write a reply..." required></textarea>
          <div class="comment-form-footer">
            <label class="spoiler-toggle">
              <input type="checkbox" name="has_spoilers" value="1" />
              <span class="spoiler-toggle-ui" aria-hidden="true"></span>
              <span class="spoiler-toggle-label">Spoilers</span>
            </label>
            <div class="edit-comment-btns">
              <button type="submit" class="nav-btn nav-btn-primary">Reply</button>
              <button type="button" class="nav-btn js-cancel-reply">Cancel</button>
            </div>
          </div>
        </form>
      </div>
      <div class="comment-replies"></div>`;
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
      if (!comment) return;
      setCommentEditing(comment, true);
      return;
    }

    const cancelBtn = e.target.closest(".js-cancel-edit");
    if (cancelBtn) {
      const comment = cancelBtn.closest(".comment");
      if (!comment) return;
      setCommentEditing(comment, false);
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
    const commentEl = form.closest(".comment");
    const commentId = form.querySelector('[name="comment_id"]').value;
    const content = (form.querySelector('[name="content"]').value || "").trim();
    const spoilerInput = form.querySelector('[name="has_spoilers"]');
    const hasSpoilers = !!(spoilerInput && spoilerInput.checked);
    if (!content) return;
    try {
      const data = await postForm("/edit-comment", {
        comment_id: commentId,
        content,
        has_spoilers: hasSpoilers ? "1" : "0",
      });
      const saved = data.comment || {};
      const finalContent = saved.content || content;
      const finalSpoilers = typeof saved.has_spoilers === "boolean" ? saved.has_spoilers : hasSpoilers;
      if (commentEl) {
        renderCommentBody(commentEl, finalContent, finalSpoilers);
        setCommentEditing(commentEl, false);
      }
    } catch (err) {
      alert(err.message || "Could not save");
    }
  });

  // Reply / collapse / spoilers
  document.addEventListener("click", (e) => {
    const replyBtn = e.target.closest(".js-reply-comment");
    if (replyBtn) {
      const comment = replyBtn.closest(".comment");
      if (!comment) return;
      const form = comment.querySelector(":scope > .comment-main .reply-comment-form");
      if (!form) return;
      document.querySelectorAll(".reply-comment-form").forEach((f) => {
        if (f !== form) f.style.display = "none";
      });
      form.style.display = form.style.display === "block" ? "none" : "block";
      if (form.style.display === "block") {
        const ta = form.querySelector("textarea");
        if (ta) ta.focus();
      }
      return;
    }

    const cancelReply = e.target.closest(".js-cancel-reply");
    if (cancelReply) {
      const form = cancelReply.closest(".reply-comment-form");
      if (form) {
        form.style.display = "none";
        form.reset();
      }
      return;
    }

    const toggle = e.target.closest(".js-toggle-thread");
    if (toggle) {
      const comment = toggle.closest(".comment");
      if (!comment) return;
      const replies = comment.querySelector(":scope > .comment-replies");
      if (!replies) return;
      const collapsed = comment.classList.toggle("is-collapsed");
      replies.hidden = collapsed;
      const count = replies.querySelectorAll(":scope > .comment").length;
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed
        ? `Show ${count} repl${count === 1 ? "y" : "ies"}`
        : `Hide ${count} repl${count === 1 ? "y" : "ies"}`;
      return;
    }

    const btn = e.target.closest(".spoiler-reveal, .spoiler-hide");
    if (!btn) return;
    const block = btn.closest("[data-spoiler]");
    if (!block) return;
    const contents = block.querySelectorAll(".spoiler-content");
    const isHidden = contents.length && contents[0].classList.contains("is-hidden");
    if (isHidden) {
      contents.forEach((el) => el.classList.remove("is-hidden"));
      btn.textContent = "Hide Spoilers";
      btn.classList.remove("spoiler-reveal");
      btn.classList.add("spoiler-hide");
      btn.classList.add("spoiler-chip");
    } else {
      contents.forEach((el) => el.classList.add("is-hidden"));
      btn.textContent = "Show Spoilers";
      btn.classList.remove("spoiler-hide");
      btn.classList.add("spoiler-reveal");
      btn.classList.add("spoiler-chip");
    }
  });

  // Reply form submit
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".reply-comment-form");
    if (!form) return;
    e.preventDefault();
    const reviewId = form.querySelector('[name="review_id"]').value;
    const parentId = form.querySelector('[name="parent_id"]').value;
    const content = (form.querySelector('[name="content"]').value || "").trim();
    const spoilerInput = form.querySelector('[name="has_spoilers"]');
    const hasSpoilers = !!(spoilerInput && spoilerInput.checked);
    if (!content) return;
    try {
      const data = await postForm("/comment", {
        review_id: reviewId,
        parent_id: parentId,
        content,
        has_spoilers: hasSpoilers ? "1" : "0",
      });
      const parent = form.closest(".comment");
      const replies = parent && parent.querySelector(":scope > .comment-replies");
      if (replies && data.comment) {
        const el = buildCommentEl(data.comment);
        replies.appendChild(el);
        parent.classList.remove("is-collapsed");
        replies.hidden = false;
        // update collapse button
        let toggle = parent.querySelector(":scope > .comment-main .js-toggle-thread");
        const count = replies.querySelectorAll(":scope > .comment").length;
        if (!toggle) {
          const footer = parent.querySelector(":scope > .comment-main .comment-footer-actions");
          if (footer) {
            toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "comment-collapse-btn js-toggle-thread";
            footer.appendChild(toggle);
          }
        }
        if (toggle) {
          toggle.setAttribute("aria-expanded", "true");
          toggle.textContent = `Hide ${count} repl${count === 1 ? "y" : "ies"}`;
        }
      }
      const section = form.closest(".comments-section");
      if (section) updateCount(section, 1);
      form.reset();
      form.style.display = "none";
    } catch (err) {
      alert(err.message || "Could not reply");
    }
  });
})();
