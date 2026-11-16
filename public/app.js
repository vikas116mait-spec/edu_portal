const app = document.querySelector("#app");
const isLoginPage = window.location.pathname.startsWith("/login");
let catalog = null;

function subjectHue(subject) {
  const identity = subject.code || subject.name;
  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.codePointAt(0)) % 360;
  }
  return hash;
}

function bindDepthTilt(root) {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!finePointer.matches || reducedMotion.matches) return;

  root.querySelectorAll(".subject-card, .material-row").forEach((surface) => {
    surface.addEventListener("pointermove", (event) => {
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      surface.style.setProperty(
        "--depth-tilt-x",
        `${((x - 0.5) * 6).toFixed(2)}deg`,
      );
      surface.style.setProperty(
        "--depth-tilt-y",
        `${((0.5 - y) * 6).toFixed(2)}deg`,
      );
    });
    surface.addEventListener("pointerleave", () => {
      surface.style.setProperty("--depth-tilt-x", "0deg");
      surface.style.setProperty("--depth-tilt-y", "0deg");
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-shell">
      <div class="login-story">
        <div class="login-story-kicker"><span></span> CS CORE / FACULTY DESK</div>
        <h1 class="login-title">Fuel<br>their <em>curiosity.</em></h1>
        <p class="login-story-copy">
          A vivid, organized home for every lesson, chapter, and idea.
        </p>
        <a class="manager-link" href="#teacher-username">
          SIGN IN TO MANAGE STUDY CONTENT <span aria-hidden="true">↘</span>
        </a>
        <div class="login-story-footer">
          <span>CS CORE PORTAL</span><span>LOCAL WORKSPACE</span>
        </div>
      </div>
      <div class="login-card">
        <div class="login-kicker">FACULTY ACCESS</div>
        <h2 class="login-form-title" id="auth-title">Teacher sign in</h2>
        <p class="login-copy" id="auth-copy">
          Sign in to open the content manager and maintain the study library.
        </p>
        <form class="login-form" id="login-form">
          <div class="form-field">
            <label for="teacher-username">Username</label>
            <input id="teacher-username" name="username" type="text"
              autocomplete="username" required />
          </div>
          <div class="form-field">
            <label for="teacher-password">Password</label>
            <input id="teacher-password" name="password" type="password"
              autocomplete="current-password" required />
          </div>
          <button class="login-submit" type="submit">SIGN IN &amp; CONTINUE</button>
        </form>
        <form class="login-form" id="register-form" hidden>
          <div class="form-field">
            <label for="teacher-name">Your name</label>
            <input id="teacher-name" name="name" type="text"
              autocomplete="name" minlength="2" maxlength="80" required />
          </div>
          <div class="form-field">
            <label for="new-teacher-username">Choose a username</label>
            <input id="new-teacher-username" name="username" type="text"
              autocomplete="username" minlength="3" maxlength="32"
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
              title="Use 3–32 letters, numbers, dots, underscores, or hyphens."
              required />
          </div>
          <div class="form-field">
            <label for="new-teacher-password">Create password</label>
            <input id="new-teacher-password" name="password" type="password"
              autocomplete="new-password" minlength="10" maxlength="256"
              required />
          </div>
          <div class="form-field">
            <label for="confirm-teacher-password">Confirm password</label>
            <input id="confirm-teacher-password" name="confirmPassword"
              type="password" autocomplete="new-password" minlength="10"
              maxlength="256" required />
          </div>
          <button class="login-submit" type="submit">CREATE TEACHER ID</button>
        </form>
        <div class="login-notice" id="login-notice" role="alert"></div>
        <button class="login-mode-toggle" id="auth-mode-toggle" type="button">
          New teacher? Create an account
        </button>
        <a class="login-back" href="/">← Return to the study library</a>
      </div>
    </section>
    <footer class="site-footer">© 2026 CS Core Portal — Dedicated Study Material for School Students.</footer>
  `;

  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const title = document.querySelector("#auth-title");
  const copy = document.querySelector("#auth-copy");
  const toggle = document.querySelector("#auth-mode-toggle");
  const notice = document.querySelector("#login-notice");

  toggle.addEventListener("click", () => {
    const registering = registerForm.hidden;
    registerForm.hidden = !registering;
    loginForm.hidden = registering;
    title.textContent = registering
      ? "Create teacher account"
      : "Teacher sign in";
    copy.textContent = registering
      ? "Create your teacher ID to add subjects, folders, and study PDFs."
      : "Sign in to open the content manager and maintain the study library.";
    toggle.textContent = registering
      ? "Already have an account? Sign in"
      : "New teacher? Create an account";
    notice.classList.remove("visible");
    notice.textContent = "";
  });

  async function submitAuthForm(event, endpoint, getPayload) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type=submit]");
    notice.classList.remove("visible");
    submit.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getPayload(new FormData(form))),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "The request could not be completed.");
      }
      window.location.replace("/admin/");
    } catch (error) {
      notice.textContent = error.message || "The local server could not be reached.";
      notice.classList.add("visible");
      submit.disabled = false;
    }
  }

  loginForm.addEventListener("submit", (event) => {
    submitAuthForm(event, "/api/session", (formData) => ({
      username: formData.get("username"),
      password: formData.get("password"),
    }));
  });
  registerForm.addEventListener("submit", (event) => {
    submitAuthForm(event, "/api/teachers", (formData) => ({
      name: formData.get("name"),
      username: formData.get("username"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    }));
  });

  fetch("/api/session")
    .then((response) => response.json())
    .then((session) => {
      if (session.authenticated) window.location.replace("/admin/");
    })
    .catch(() => {});
}

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function subjectDocuments(subjectName) {
  return catalog.materials.filter(
    (document) => document.subject === subjectName,
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesSearch(query, values) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchableText = normalizeSearchText(values.join(" "));
  return terms.every((term) => searchableText.includes(term));
}

function getVisibleFolders(subject, query) {
  const normalizedQuery = normalizeSearchText(query);
  const subjectMatches = matchesSearch(query, [
    subject.name,
    subject.code,
    subject.description,
  ]);
  const documents = subjectDocuments(subject.name);

  return subject.folders.map((folderName) => {
    const folderMatches = matchesSearch(query, [folderName]);
    const matchingDocuments = documents.filter((document) => {
      if (document.folder !== folderName) return false;
      if (!normalizedQuery || subjectMatches || folderMatches) return true;
      return matchesSearch(query, [
        subject.name,
        subject.code,
        folderName,
        document.title,
        document.fileName,
        document.description,
      ]);
    });

    return { name: folderName, documents: matchingDocuments };
  }).filter((folder) => {
    return !normalizedQuery || subjectMatches || folder.documents.length ||
      matchesSearch(query, [folder.name]);
  });
}

function searchCatalog(query) {
  if (!normalizeSearchText(query)) return [];

  const results = [];
  catalog.subjects.forEach((subject) => {
    if (matchesSearch(query, [subject.name, subject.code, subject.description])) {
      results.push({ type: "subject", subject });
    }
  });

  catalog.materials.forEach((document) => {
    const subject = catalog.subjects.find(
      (item) => item.name === document.subject,
    );
    if (!subject) return;
    if (matchesSearch(query, [
      subject.name,
      subject.code,
      document.folder,
      document.title,
      document.fileName,
      document.description,
    ])) {
      results.push({
        type: "document",
        subject,
        folderName: document.folder,
        document,
      });
    }
  });

  catalog.subjects.forEach((subject) => {
    subject.folders.forEach((folderName) => {
      if (matchesSearch(query, [folderName])) {
        results.push({ type: "folder", subject, folderName });
      }
    });
  });

  return results;
}

function renderSearchResult(result, index) {
  const symbol = result.type === "subject"
    ? result.subject.icon
    : result.type === "folder" ? "▰" : "PDF";
  const title = result.type === "subject"
    ? result.subject.name
    : result.type === "folder" ? result.folderName : result.document.title;
  let detail = result.subject.description || "Study subject";
  if (result.type === "folder") {
    const count = subjectDocuments(result.subject.name).filter(
      (document) => document.folder === result.folderName,
    ).length;
    detail = result.subject.name + " · " + count +
      (count === 1 ? " PDF" : " PDFs");
  } else if (result.type === "document") {
    detail = result.subject.name + " / " + result.folderName + " · " +
      result.document.fileName;
  }

  return [
    '<button class="search-result" type="button" data-search-index="' + index + '">',
    '<span class="search-result-symbol" aria-hidden="true">' +
      escapeHtml(symbol) + '</span>',
    '<span class="search-result-copy"><strong>' + escapeHtml(title) +
      '</strong><small>' + escapeHtml(detail) + '</small></span>',
    '<span class="search-result-type">' + result.type + ' <i>↗</i></span>',
    '</button>',
  ].join("");
}

function renderSearchResults(panel, results, query) {
  const normalizedQuery = normalizeSearchText(query);
  panel.hidden = !normalizedQuery;
  if (!normalizedQuery) {
    panel.innerHTML = "";
    return;
  }

  const visibleResults = results.slice(0, 7);
  const resultCount = results.length;
  const resultLabel = resultCount === 1 ? "1 match" : resultCount + " matches";
  const resultItems = visibleResults.map(renderSearchResult).join("");
  panel.innerHTML = [
    '<div class="search-results-heading"><strong>SEARCH RESULTS</strong>',
    '<span>' + resultLabel + '</span></div>',
    resultCount
      ? '<div class="search-results-list">' + resultItems + '</div>' +
        (resultCount > visibleResults.length
          ? '<p class="search-results-more">Showing 7 of ' + resultCount + ' matches</p>'
          : '')
      : '<p class="search-results-empty">No matches. Try a subject, folder, title, or PDF filename.</p>',
  ].join("");
}

function openSearchResult(result, query) {
  if (!result) return;
  const searchQuery = result.type === "subject" ? "" : query;
  renderPortal(result.subject.name, searchQuery);

  requestAnimationFrame(() => {
    let target = document.querySelector("#workspace");
    if (result.folderName) {
      const folder = Array.from(document.querySelectorAll(".folder-card"))
        .find((card) => card.dataset.folder === result.folderName);
      if (folder) {
        folder.dataset.open = "true";
        folder.querySelector(".folder-toggle")
          ?.setAttribute("aria-expanded", "true");
        const action = folder.querySelector(".folder-action");
        if (action) action.textContent = "Collapse";
        target = folder;
      }
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderMaterial(document) {
  return [
    '<article class="material-row">',
    '<span class="material-icon" aria-hidden="true">',
    '<svg viewBox="0 0 20 22" fill="none">',
    '<path d="M4 1.5h8l4 4v15H4z" />',
    '<path d="M12 1.5v4h4M7 11h6M7 14h6" />',
    '</svg></span>',
    '<div class="material-info">',
    '<h3 class="material-title">' + escapeHtml(document.title) + '</h3>',
    '<div class="material-filename">' +
      escapeHtml(document.fileName) + ' · ' +
      formatSize(document.fileSize) + '</div>',
    '</div>',
    '<a class="material-open" href="' + escapeHtml(document.pdfUrl) +
      '" target="_blank" rel="noopener noreferrer" aria-label="Open ' +
      escapeHtml(document.title) + ' PDF">',
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">',
    '<path d="M7 5h8v8M15 5 5 15" />',
    '</svg></a>',
    '</article>',
  ].join("");
}

function renderWorkspace(subject, query) {
  const folders = getVisibleFolders(subject, query);
  const totalDocuments = subjectDocuments(subject.name).length;
  const matchingDocuments = folders.reduce(
    (total, folder) => total + folder.documents.length,
    0,
  );
  const noMatches = query.trim() && folders.length === 0;
  const folderCards = folders.map((folder) => {
    const openByDefault = folder.documents.length > 0;
    const fileCount = folder.documents.length;
    const fileLabel = fileCount === 1 ? "file inside" : "files inside";
    const folderContents = folder.documents.length
      ? folder.documents.map(renderMaterial).join("")
      : '<div class="empty-folder">No study documents in this folder yet.</div>';

    return [
      '<section class="folder-card" data-open="' + openByDefault +
        '" data-folder="' + escapeHtml(folder.name) + '">',
      '<button class="folder-toggle" type="button" aria-expanded="' +
        openByDefault + '">',
      '<span class="folder-heading">',
      '<span class="folder-icon" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" fill="none">',
      '<path d="M3 6.5h7l2 2h9v10H3z" />',
      '<path d="M3 8.5h18" />',
      '</svg></span>',
      '<span class="folder-copy">',
      '<span class="folder-name">' + escapeHtml(folder.name) + '</span>',
      '<span class="folder-meta">' + fileCount + ' ' + fileLabel + '</span>',
      '</span></span>',
      '<span class="folder-controls">',
      '<span class="folder-action">' +
        (openByDefault ? "Collapse" : "Expand") + '</span>',
      '<svg class="folder-caret" viewBox="0 0 18 18" fill="none" aria-hidden="true">',
      '<path d="m7 4 5 5-5 5" />',
      '</svg></span>',
      '</button>',
      '<div class="folder-content">' + folderContents + '</div>',
      '</section>',
    ].join("");
  }).join("");

  return [
    '<section class="workspace-card" aria-label="' +
      escapeHtml(subject.name) + ' file explorer">',
    '<div class="workspace-header"><div>',
    '<div class="breadcrumb">Subject Workspace&nbsp; › &nbsp;<strong>' +
      escapeHtml(subject.name) + '</strong></div>',
    '<h2 class="workspace-title">' + escapeHtml(subject.name) +
      ' File Explorer</h2></div>',
    '<div class="count-pill">' + subject.folders.length +
      ' Folders&nbsp; • &nbsp;' + totalDocuments +
      ' Total Documents</div></div>',
    '<div class="folder-list">',
    noMatches
      ? '<div class="no-results">No matching files found for “' +
        escapeHtml(query) + '”.</div>'
      : "",
    folderCards,
    '</div></section>',
  ].join("");
}

function renderSubjectCards(activeSubject) {
  return catalog.subjects.map((subject, index) => {
    const isActive = subject.name === activeSubject;
    const documentCount = subjectDocuments(subject.name).length;
    const folderCount = subject.folders.length;
    return `
      <button
        class="subject-card${isActive ? " active" : ""}"
        style="--subject-hue: ${subjectHue(subject)}"
        type="button"
        data-subject="${escapeHtml(subject.name)}"
        aria-pressed="${isActive}"
        title="${escapeHtml(subject.description)}"
      >
        <span class="subject-topline">
          <span class="subject-icon" aria-hidden="true">${escapeHtml(subject.icon)}</span>
          <span class="subject-code">${escapeHtml(subject.code)}</span>
        </span>
        <span class="subject-card-bottom">
          <span class="subject-name">${escapeHtml(subject.name)}</span>
          <span class="subject-count">${folderCount} ${folderCount === 1 ? "folder" : "folders"} <i>·</i> ${documentCount} ${documentCount === 1 ? "PDF" : "PDFs"}</span>
        </span>
        <span class="subject-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="subject-arrow" aria-hidden="true">↗</span>
      </button>
    `;
  }).join("");
}

function renderPortal(activeSubject, query = "") {
  const requestedSubject = activeSubject ||
    new URLSearchParams(window.location.search).get("subject");
  const subject = catalog.subjects.find(
    (item) => item.name === requestedSubject,
  ) || catalog.subjects[0];
  const folderCount = catalog.subjects.reduce(
    (total, item) => total + item.folders.length,
    0,
  );
  const previewSubjects = [
    subject,
    ...catalog.subjects.filter((item) => item.name !== subject.name),
  ].slice(0, 4);
  const additionalSubjectCount = catalog.subjects.length - previewSubjects.length;
  const proofSubjectChips = catalog.subjects.slice(0, 3).map((item) =>
    '<span style="--subject-hue:' + subjectHue(item) + '" title="' +
      escapeHtml(item.name) + '">' + escapeHtml(item.icon) + '</span>',
  ).join("");
  const proofSubjectOverflow = catalog.subjects.length > 3
    ? '<span>+' + (catalog.subjects.length - 3) + '</span>'
    : "";
  const sceneSubjectCards = previewSubjects.map((item, index) => {
    const selected = item.name === subject.name;
    const documents = subjectDocuments(item.name).length;
    const folders = item.folders.length;
    return ` 
      <button class="scene-module scene-module-${index}${selected ? " is-current" : ""}"
        type="button" data-subject="${escapeHtml(item.name)}"
        aria-pressed="${selected}"
        style="--subject-hue:${subjectHue(item)};--module-delay:${index * 110}ms"
        title="Explore ${escapeHtml(item.name)}">
        <span class="module-head"><small>${escapeHtml(item.code)}</small><i></i></span>
        <span class="module-icon">${escapeHtml(item.icon)}</span>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="module-meta">${folders} ${folders === 1 ? "folder" : "folders"}<i>·</i>${documents} ${documents === 1 ? "PDF" : "PDFs"}</span>
        <span class="module-arrow" aria-hidden="true">↗</span>
      </button>`;
  }).join("");
  const tickerItems = catalog.subjects.map((item) => `
    <span class="marquee-course" style="--subject-hue:${subjectHue(item)}">
      <i>${escapeHtml(item.icon)}</i><strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(item.code)}</small><b>✳</b>
    </span>
  `).join("");
  const featuredMaterial = subjectDocuments(subject.name)[0] || null;
  const featuredFolder = subject.folders[0] || null;

  app.innerHTML = `
    <div class="portal-shell">
      <section class="hero reference-hero" aria-labelledby="hero-title">
        <div class="hero-command-bar">
          <span class="command-brand"><b>CS✳</b><i></i> CORE STUDY PORTAL</span>
          <span class="command-status"><i></i> STUDY LIBRARY ONLINE</span>
          <span class="command-stat">${catalog.subjects.length} PATHS <b>·</b> ${folderCount} FOLDERS <b>·</b> ${catalog.materials.length} PDFS</span>
        </div>
        <div class="hero-copy-column">
          <div class="hero-badge"><span class="badge-dot"></span>YOUR COMPUTER SCIENCE STUDY SPACE</div>
          <h1 class="hero-title" id="hero-title">STUDY<br>SMARTER.<br><em>GO DEEPER.</em></h1>
          <p class="hero-copy">
            Your subjects, folders, and study PDFs come together in one clear
            learning space. Pick a path and get straight to the good stuff.
          </p>
          <div class="search-area">
            <label class="search-wrap">
              <span class="search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
              </span>
              <input
                class="search-input"
                id="material-search"
                type="search"
                value="${escapeHtml(query)}"
                placeholder="Search subjects, topics, folders, and PDF names..."
                autocomplete="off"
                aria-label="Search subjects, folders, and study document details"
                aria-controls="search-results"
                aria-expanded="false"
              />
              <span class="search-hint" aria-hidden="true">↵</span>
            </label>
            <div class="search-results" id="search-results" role="region"
              aria-label="Search results" aria-live="polite" hidden></div>
          </div>
          <a class="hero-browse-link" href="#subject-heading">EXPLORE THE STUDY LIBRARY <span aria-hidden="true">↘</span></a>
          <div class="hero-proof">
            <div class="proof-avatars" aria-hidden="true">
              ${proofSubjectChips}${proofSubjectOverflow}
            </div>
            <p><strong>${catalog.subjects.length} learning paths</strong><br>Ready when you are</p>
          </div>
        </div>
        <aside class="hero-visual study-network" aria-label="Interactive 3D map of subjects in the study library">
          <div class="network-topline"><span><i></i> LEARNING PATHS</span><span>SELECT A COURSE TO EXPLORE</span></div>
          <div class="network-canvas">
            <div class="network-halo halo-one" aria-hidden="true"></div>
            <div class="network-halo halo-two" aria-hidden="true"></div>
            <svg class="network-wires" viewBox="0 0 640 480" aria-hidden="true">
              <path d="M320 233 130 135 504 119M320 233 506 353M130 135 90 342M504 119 552 310M90 342 320 405 506 353" />
              <path d="M320 233 320 405" class="wire-dash" />
              <circle cx="130" cy="135" r="5"/><circle cx="504" cy="119" r="5"/>
              <circle cx="90" cy="342" r="5"/><circle cx="506" cy="353" r="5"/>
              <circle cx="320" cy="405" r="5"/>
            </svg>
            <div class="network-deck" aria-hidden="true"><span></span><span></span><span></span></div>
            ${sceneSubjectCards}
            ${additionalSubjectCount > 0
              ? '<button class="network-more" type="button" data-scroll-subjects>+' + additionalSubjectCount + ' MORE SUBJECTS <span>↘</span></button>'
              : ""}
            <div class="network-document">
              <span class="network-pdf">PDF</span>
              <span><small>${featuredMaterial ? "STUDY MATERIAL" : "STUDY LIBRARY"}</small>
                <strong>${escapeHtml(featuredMaterial ? featuredMaterial.title : subject.name)}</strong>
                <em>${escapeHtml(featuredMaterial ? featuredMaterial.fileName : (featuredFolder || "Ready for your first folder"))}</em>
              </span>
              <b aria-hidden="true">↗</b>
            </div>
            <div class="network-stamp" aria-hidden="true"><span>LEARN</span><b>×</b><span>GROW</span><b>×</b><span>REPEAT</span></div>
          </div>
          <div class="network-bottomline"><span>ONE LIBRARY. EVERY NEXT STEP.</span><span>${String(catalog.subjects.length).padStart(2, "0")} <i>/</i> ${String(catalog.materials.length).padStart(2, "0")} PDFS</span></div>
        </aside>
      </section>

      <div class="library-ribbon" aria-label="Library overview">
        <div><span class="ribbon-number">01</span><span>CHOOSE A SUBJECT</span></div>
        <span class="ribbon-mark" aria-hidden="true">✳</span>
        <div><span class="ribbon-number">${String(folderCount).padStart(2, "0")}</span><span>FOLLOW A FOLDER</span></div>
        <span class="ribbon-mark" aria-hidden="true">✳</span>
        <div><span class="ribbon-number">${String(catalog.materials.length).padStart(2, "0")}</span><span>OPEN A DOCUMENT</span></div>
        <span class="ribbon-aside">YOUR NEXT GOOD IDEA IS IN HERE <i>↘</i></span>
      </div>

      <div class="course-marquee" aria-hidden="true">
        <div class="marquee-track">${tickerItems}${tickerItems}</div>
      </div>

      <section class="subject-section" aria-labelledby="subject-heading">
        <div class="section-heading">
          <div class="section-heading-copy">
            <div class="section-kicker"><span class="section-index">01</span> THE SUBJECT SHELF</div>
            <h2 class="section-title" id="subject-heading">Pick your starting point<span>.</span></h2>
          </div>
          <div class="viewing-label"><span class="viewing-dot"></span> NOW EXPLORING <strong>${escapeHtml(subject.name)}</strong></div>
        </div>
        <div class="subject-grid">${renderSubjectCards(subject.name)}</div>
      </section>

      <div id="workspace">${renderWorkspace(subject, query)}</div>
    </div>
    <footer class="site-footer"><span class="footer-brand">CS CORE<span>✳</span></span><span>Thoughtfully gathered for curious minds.</span><span>© 2026</span></footer>
  `;

  app.querySelector("[data-scroll-subjects]")?.addEventListener("click", () => {
    app.querySelector(".subject-section")?.scrollIntoView({ behavior: "smooth" });
  });

  app.querySelectorAll("[data-subject]").forEach((card) => {
    card.addEventListener("click", () => {
      renderPortal(card.dataset.subject, "");
    });
  });

  const heroVisual = app.querySelector(".hero-visual");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (heroVisual && finePointer.matches && !reducedMotion.matches) {
    let pointerFrame = 0;
    heroVisual.addEventListener("pointermove", (event) => {
      const bounds = heroVisual.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        heroVisual.style.setProperty("--spotlight-x", `${x * 100}%`);
        heroVisual.style.setProperty("--spotlight-y", `${y * 100}%`);
        heroVisual.style.setProperty("--tilt-x", `${(x - 0.5) * 4}deg`);
        heroVisual.style.setProperty("--tilt-y", `${(0.5 - y) * 4}deg`);
      });
    });
    heroVisual.addEventListener("pointerleave", () => {
      cancelAnimationFrame(pointerFrame);
      heroVisual.style.setProperty("--spotlight-x", "50%");
      heroVisual.style.setProperty("--spotlight-y", "47%");
      heroVisual.style.setProperty("--tilt-x", "0deg");
      heroVisual.style.setProperty("--tilt-y", "0deg");
    });
  }

  const searchInput = document.querySelector("#material-search");
  const searchResults = document.querySelector("#search-results");
  let currentSearchResults = [];

  searchInput.addEventListener("input", () => {
    const searchQuery = searchInput.value;
    currentSearchResults = searchCatalog(searchQuery);
    renderSearchResults(searchResults, currentSearchResults, searchQuery);
    searchInput.setAttribute(
      "aria-expanded",
      String(Boolean(normalizeSearchText(searchQuery))),
    );
    const workspace = document.querySelector("#workspace");
    workspace.innerHTML = renderWorkspace(subject, searchQuery);
    bindFolderToggles();
    bindDepthTilt(workspace);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchResults.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
      return;
    }
    if (event.key === "Enter" && currentSearchResults.length) {
      event.preventDefault();
      openSearchResult(currentSearchResults[0], searchInput.value);
    }
  });

  searchResults.addEventListener("click", (event) => {
    const resultButton = event.target.closest("[data-search-index]");
    if (!resultButton) return;
    const result = currentSearchResults[Number(resultButton.dataset.searchIndex)];
    openSearchResult(result, searchInput.value);
  });

  bindFolderToggles();
  bindDepthTilt(app);
}

function bindFolderToggles() {
  document.querySelectorAll(".folder-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const folder = button.closest(".folder-card");
      const isOpen = folder.dataset.open === "true";
      folder.dataset.open = String(!isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
      const action = button.querySelector(".folder-action");
      if (action) action.textContent = isOpen ? "Expand" : "Collapse";
    });
  });
}

async function loadCatalog() {
  app.innerHTML = `
    <div class="portal-shell">
      <p class="state-message">Loading the study directory…</p>
    </div>
  `;

  try {
    let response;
    try {
      response = await fetch("/api/catalog");
    } catch {
      // Vercel's static deployment may not have an API server configured.
    }
    if (!response?.ok) response = await fetch("/catalog.json");
    if (!response.ok) {
      throw new Error(`Catalog request failed (${response.status})`);
    }
    catalog = await response.json();
    if (!catalog.subjects?.length) {
      throw new Error("The demo catalog does not contain any subjects.");
    }
    renderPortal();
  } catch (error) {
    app.innerHTML = `
      <div class="portal-shell">
        <section class="state-card">
          <h1 class="state-title">The study directory is unavailable</h1>
          <p class="state-message">
            The catalog could not be loaded. Please try again later.
          </p>
        </section>
      </div>
    `;
    console.error("Could not load the demo catalog:", error);
  }
}

if (isLoginPage) {
  renderLogin();
} else {
  loadCatalog();
}
