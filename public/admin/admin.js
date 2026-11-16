(() => {
  const app = document.querySelector("#admin-app");
  if (!app) return;

  const state = {
    catalog: null,
    health: null,
    folderSubject: "",
    uploadSubject: "",
    uploadFolder: "",
    editingMaterialId: "",
  };

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

  function selectedSubject(name) {
    return state.catalog.subjects.find((subject) => subject.name === name);
  }

  function subjectsForOptions(selectedName) {
    return state.catalog.subjects.map((subject) =>
      '<option value="' + escapeHtml(subject.name) + '"' +
      (subject.name === selectedName ? " selected" : "") + ">" +
      escapeHtml(subject.name) + "</option>",
    ).join("");
  }

  function foldersForSubject(subjectName) {
    return selectedSubject(subjectName)?.folders || [];
  }

  function folderOptions(subjectName, selectedFolder) {
    return foldersForSubject(subjectName).map((folder) =>
      '<option value="' + escapeHtml(folder) + '"' +
      (folder === selectedFolder ? " selected" : "") + ">" +
      escapeHtml(folder) + "</option>",
    ).join("");
  }

  function formatSize(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    let result = {};
    try {
      result = await response.json();
    } catch (error) {
      if (response.ok) throw error;
    }
    if (!response.ok) {
      throw new Error(result.error || "The request could not be completed.");
    }
    return result;
  }

  function setNotice(message, kind) {
    const notice = app.querySelector("#admin-notice");
    notice.textContent = message;
    notice.className = "admin-notice";
    if (kind) notice.classList.add("is-" + kind);
    notice.hidden = !message;
  }

  function renderFolderList() {
    const subject = selectedSubject(state.folderSubject);
    const folders = subject?.folders || [];
    const list = app.querySelector("#admin-folder-list");
    app.querySelector("#folder-list-subject").textContent =
      subject?.name || "";
    app.querySelector("#folder-count").textContent =
      folders.length + (folders.length === 1 ? " folder" : " folders");

    if (!folders.length) {
      list.innerHTML =
        '<p class="admin-empty-inline">No folders created for ' +
        escapeHtml(subject?.name || "this subject") + " yet.</p>";
      return;
    }

    list.innerHTML = folders.map((folder) => [
      '<span class="admin-folder-chip">',
      '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">',
      '<path d="M2.5 5h5.2l1.5 1.7h8.3v8.8H2.5z" />',
      '</svg><span>' + escapeHtml(folder) + '</span>',
      '<button class="admin-icon-button is-danger" type="button"',
      ' data-delete-folder data-subject="' + escapeHtml(subject.name) +
        '" data-folder="' + escapeHtml(folder) + '"',
      ' aria-label="Delete folder ' + escapeHtml(folder) + ' and its files"',
      ' title="Delete folder and its files">',
      '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">',
      '<path d="M4 6h12M8 6V4h4v2m-6 0 .6 10h6.8L14 6m-4 3v4m2-4v4" />',
      '</svg></button></span>',
    ].join("")).join("");
  }

  function renderDocumentCard(material) {
    if (state.editingMaterialId === material.id) {
      return renderEditForm(material);
    }
    return [
      '<article class="admin-document-card">',
      '<div class="admin-document-main">',
      '<span class="admin-document-icon" aria-hidden="true">PDF</span>',
      '<div class="admin-document-copy">',
      '<h3>' + escapeHtml(material.title) + '</h3>',
      '<p>' + escapeHtml(material.subject) + ' / ' +
        escapeHtml(material.folder) + '</p>',
      '<p>' + escapeHtml(material.fileName) + ' · ' +
        formatSize(material.fileSize) + '</p>',
      material.description
        ? '<p class="admin-document-description">' +
          escapeHtml(material.description) + '</p>'
        : "",
      '</div></div>',
      '<div class="admin-document-actions">',
      '<a class="admin-small-link" href="' + escapeHtml(material.pdfUrl) +
        '" target="_blank" rel="noopener noreferrer">OPEN PDF ↗</a>',
      '<button class="admin-small-button" type="button" data-edit-material="' +
        escapeHtml(material.id) + '">EDIT</button>',
      '<label class="admin-small-button admin-replace-label">REPLACE PDF',
      '<input type="file" accept=".pdf,application/pdf"',
      ' data-replace-material="' + escapeHtml(material.id) + '">',
      '</label>',
      '<button class="admin-small-button is-danger" type="button"',
      ' data-delete-material="' + escapeHtml(material.id) + '">DELETE</button>',
      '</div></article>',
    ].join("");
  }

  function renderEditForm(material) {
    return [
      '<form class="admin-edit-form" data-edit-form="' +
        escapeHtml(material.id) + '">',
      '<label>Document title<input name="title" maxlength="200" required value="' +
        escapeHtml(material.title) + '"></label>',
      '<label>Folder<select name="folder" required>' +
        folderOptions(material.subject, material.folder) + '</select></label>',
      '<label class="admin-edit-description">Description',
      '<textarea name="description" maxlength="2000" rows="3">' +
        escapeHtml(material.description) + '</textarea></label>',
      '<div class="admin-edit-actions">',
      '<button class="admin-small-button" type="submit">SAVE DETAILS</button>',
      '<button class="admin-small-button" type="button" data-cancel-edit>CANCEL</button>',
      '</div></form>',
    ].join("");
  }

  function renderDocumentList() {
    const materials = state.catalog.materials.filter(
      (material) => material.subject === state.uploadSubject,
    );
    app.querySelector("#existing-documents-count").textContent = materials.length;
    const list = app.querySelector("#admin-document-list");
    if (!materials.length) {
      list.innerHTML = [
        '<div class="admin-empty-documents">',
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">',
        '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" />',
        '</svg><h3>No files yet</h3>',
        '<p>Select a subject, pick a folder, and upload your PDF.</p>',
        '</div>',
      ].join("");
      return;
    }
    list.innerHTML = materials.map(renderDocumentCard).join("");
  }

  function updateUploadFolderOptions() {
    const folders = foldersForSubject(state.uploadSubject);
    const select = app.querySelector("#admin-upload-folder");
    const label = app.querySelector("#admin-upload-folder-label");
    label.textContent = "2. Select folder inside " + state.uploadSubject;
    select.innerHTML = folderOptions(state.uploadSubject, state.uploadFolder);
    select.disabled = folders.length === 0;
    if (folders.length) {
      if (!folders.includes(state.uploadFolder)) {
        state.uploadFolder = folders[0];
        select.value = state.uploadFolder;
      }
      app.querySelector("#admin-upload-submit").disabled = false;
      app.querySelector("#admin-no-folder").hidden = true;
    } else {
      state.uploadFolder = "";
      app.querySelector("#admin-upload-submit").disabled = true;
      app.querySelector("#admin-no-folder").hidden = false;
    }
  }

  function renderAdmin() {
    const maxNameLength = Number(state.health.maxFolderNameLength) || 100;
    const maxFileSize = Number(state.health.maxUploadBytes) || 0;
    const maxFileMiB = Math.floor(maxFileSize / (1024 * 1024));
    const subjectCount = state.catalog.subjects.length;
    const folderCount = state.catalog.subjects.reduce(
      (total, subject) => total + subject.folders.length,
      0,
    );
    const documentCount = state.catalog.materials.length;

    app.querySelector(".admin-shell").innerHTML = [
      '<section class="admin-intro" aria-labelledby="admin-page-title">',
      '<div class="admin-intro-copy">',
      '<p class="admin-intro-kicker">CS CORE / LIBRARY STUDIO</p>',
      '<h1 id="admin-page-title">Curate the <em>library.</em></h1>',
      '<p>Build a well-organised home for every course, chapter, and study document.</p>',
      '</div><div class="admin-intro-stats">',
      '<div><strong>' + subjectCount + '</strong><span>subjects</span></div>',
      '<div><strong>' + folderCount + '</strong><span>folders</span></div>',
      '<div><strong>' + documentCount + '</strong><span>PDFs</span></div>',
      '</div></section>',
      '<div id="admin-notice" class="admin-notice" role="status" hidden></div>',
      '<section class="admin-folder-panel" aria-labelledby="admin-subject-heading">',
      '<div class="admin-panel-heading">',
      '<span class="admin-panel-icon" aria-hidden="true">＋</span>',
      '<div><h2 id="admin-subject-heading">Create New Subject</h2>',
      '<p>Add a subject partition to the directory and admin selectors.</p>',
      '</div></div>',
      '<form class="admin-folder-form admin-subject-form" id="admin-subject-form">',
      '<label>Subject Name<input name="name" type="text" maxlength="' +
        Number(state.health.maxSubjectNameLength || 80) + '" required',
      ' placeholder="e.g. Computer Graphics"></label>',
      '<label>Course Code<input name="code" type="text" maxlength="' +
        Number(state.health.maxSubjectCodeLength || 32) + '" required',
      ' placeholder="e.g. CG-401"></label>',
      '<label>Description<input name="description" type="text" maxlength="' +
        Number(state.health.maxSubjectDescriptionLength || 200) + '"',
      ' placeholder="Topics covered in this subject"></label>',
      '<label>Card Icon<input name="icon" type="text" maxlength="' +
        Number(state.health.maxSubjectIconLength || 12) + '" required',
      ' placeholder="e.g. ✦"></label>',
      '<label>First Folder <span>(optional)</span><input name="firstFolder"',
      ' type="text" maxlength="' + maxNameLength + '"',
      ' placeholder="e.g. Unit 1: Fundamentals"></label>',
      '<button class="admin-primary-button" type="submit">＋ &nbsp; ADD SUBJECT</button>',
      '</form></section>',
      '<section class="admin-folder-panel" id="admin-workspace">',
      '<div class="admin-panel-heading">',
      '<span class="admin-panel-icon" aria-hidden="true">',
      '<svg viewBox="0 0 20 20" fill="none">',
      '<path d="M2.5 5h5.2l1.5 1.7h8.3v8.8H2.5zM10 9v4m-2-2h4" />',
      '</svg></span><div><h2>Create New Folder / Unit</h2>',
      '<p>Add a top folder (e.g. "Unit 1: Fundamentals", "Chapter 3: Trees") to any subject</p>',
      '</div></div>',
      '<form class="admin-folder-form" id="admin-folder-form">',
      '<label>Select Subject<select id="admin-folder-subject" required>' +
        subjectsForOptions(state.folderSubject) + '</select></label>',
      '<label>New Folder Name<input id="admin-folder-name" name="folder"',
      ' type="text" maxlength="' + maxNameLength + '" required',
      ' placeholder="e.g. Unit 5: Graph Theory, Chapter 2: Pointers"></label>',
      '<button class="admin-primary-button" type="submit">＋ &nbsp; ADD FOLDER</button>',
      '</form>',
      '<div class="admin-folder-list-wrap">',
      '<div class="admin-folder-list-heading">',
      '<span>Folders in <strong id="folder-list-subject"></strong> (click trash icon to delete folder &amp; files):</span>',
      '<span id="folder-count"></span></div>',
      '<div class="admin-folder-list" id="admin-folder-list"></div>',
      '</div></section>',
      '<section class="admin-management-grid">',
      '<section class="admin-upload-card" aria-labelledby="admin-upload-heading">',
      '<div class="admin-upload-heading"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true">',
      '<path d="M10 13V3m-4 4 4-4 4 4M3 13v4h14v-4" />',
      '</svg><h2 id="admin-upload-heading">Upload PDF to Folder</h2></div>',
      '<form id="admin-upload-form" class="admin-upload-form">',
      '<label>1. Subject<select id="admin-upload-subject" name="subject" required>' +
        subjectsForOptions(state.uploadSubject) + '</select></label>',
      '<label><span id="admin-upload-folder-label">2. Select folder inside ' +
        escapeHtml(state.uploadSubject) + '</span><select id="admin-upload-folder" name="folder" required>' +
        folderOptions(state.uploadSubject, state.uploadFolder) + '</select></label>',
      '<p class="admin-no-folder" id="admin-no-folder" hidden>No folders found in ' +
        escapeHtml(state.uploadSubject) + '. Please create a folder using the box above first!</p>',
      '<label>3. Material title<input name="title" type="text" maxlength="200" required',
      ' placeholder="e.g. Chapter 1: Introduction to Variables"></label>',
      '<label>Description<textarea name="description" maxlength="2000" rows="3"',
      ' placeholder="Optional details about this PDF"></textarea></label>',
      '<label>4. PDF file<input id="admin-pdf-file" name="pdf" type="file"',
      ' accept=".pdf,application/pdf" required></label>',
      '<p class="admin-file-hint">PDF only' +
        (maxFileMiB ? ' · Up to ' + maxFileMiB + ' MiB' : '') + '</p>',
      '<button class="admin-primary-button admin-upload-button" id="admin-upload-submit"',
      ' type="submit">UPLOAD PDF</button>',
      '</form></section>',
      '<section class="admin-documents" aria-labelledby="admin-documents-heading">',
      '<h2 id="admin-documents-heading">',
      '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">',
      '<path d="M4 2.5h8l4 4v11H4zM12 2.5v4h4M7 11h6M7 14h6" />',
      '</svg>Existing Documents (<span id="existing-documents-count">0</span>)</h2>',
      '<div id="admin-document-list" class="admin-document-list"></div>',
      '</section></section>',
      '<dialog class="admin-delete-dialog" id="admin-delete-dialog">',
      '<form id="admin-delete-form" method="dialog">',
      '<h2>Delete folder and files?</h2>',
      '<p id="admin-delete-copy"></p>',
      '<p class="admin-delete-warning">This removes the folder and its documents from the local portal.</p>',
      '<label>Type <strong>delete</strong> to confirm',
      '<input id="admin-delete-confirmation" autocomplete="off" required></label>',
      '<p class="admin-delete-error" id="admin-delete-error" role="alert"></p>',
      '<div class="admin-dialog-actions">',
      '<button class="admin-small-button" type="button" data-cancel-folder-delete>Cancel</button>',
      '<button class="admin-small-button is-danger" type="submit">DELETE FOLDER</button>',
      '</div></form></dialog>',
    ].join("");

    renderFolderList();
    updateUploadFolderOptions();
    renderDocumentList();
  }

  async function reloadCatalog() {
    const [catalog, health] = await Promise.all([
      requestJson("/api/catalog"),
      requestJson("/api/health"),
    ]);
    if (!catalog.subjects?.length) {
      throw new Error("The catalog does not contain any subjects.");
    }
    state.catalog = catalog;
    state.health = health;
    const names = catalog.subjects.map((subject) => subject.name);
    if (!names.includes(state.folderSubject)) state.folderSubject = names[0];
    if (!names.includes(state.uploadSubject)) state.uploadSubject = names[0];
    const uploadFolders = foldersForSubject(state.uploadSubject);
    if (!uploadFolders.includes(state.uploadFolder)) {
      state.uploadFolder = uploadFolders[0] || "";
    }
    renderAdmin();
  }

  function openFolderDeleteDialog(subject, folder) {
    const dialog = app.querySelector("#admin-delete-dialog");
    dialog.dataset.subject = subject;
    dialog.dataset.folder = folder;
    app.querySelector("#admin-delete-copy").textContent =
      'Delete "' + folder + '" from ' + subject + '?';
    app.querySelector("#admin-delete-confirmation").value = "";
    app.querySelector("#admin-delete-error").textContent = "";
    dialog.showModal();
  }

  async function handleCreateSubject(form) {
    const submit = form.querySelector("button[type=submit]");
    const formData = new FormData(form);
    submit.disabled = true;
    setNotice("Creating the subject…", "pending");
    try {
      const result = await requestJson("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          code: formData.get("code"),
          description: formData.get("description"),
          icon: formData.get("icon"),
          firstFolder: formData.get("firstFolder"),
        }),
      });
      state.folderSubject = result.subject.name;
      state.uploadSubject = result.subject.name;
      state.uploadFolder = result.subject.folders[0] || "";
      await reloadCatalog();
      setNotice(
        'Created "' + result.subject.name + '".' +
          (result.subject.folders.length
            ? " It is ready for uploads."
            : " Add a folder before uploading documents."),
        "success",
      );
    } catch (error) {
      setNotice(error.message || "The subject could not be created.", "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function handleCreateFolder(form) {
    const submit = form.querySelector("button[type=submit]");
    const nameInput = form.querySelector("#admin-folder-name");
    submit.disabled = true;
    setNotice("Creating the folder…", "pending");
    try {
      const result = await requestJson("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: state.folderSubject,
          folder: nameInput.value,
        }),
      });
      state.folderSubject = result.subject;
      state.uploadSubject = result.subject;
      state.uploadFolder = result.folder;
      await reloadCatalog();
      setNotice('Created "' + result.folder + '" under ' + result.subject + '.', "success");
    } catch (error) {
      setNotice(error.message || "The folder could not be created.", "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function handleUpload(form) {
    const submit = form.querySelector("#admin-upload-submit");
    const fileInput = form.querySelector("#admin-pdf-file");
    const file = fileInput.files[0];
    if (!file) {
      setNotice("Choose a PDF file to upload.", "error");
      return;
    }
    if (state.health.maxUploadBytes && file.size > state.health.maxUploadBytes) {
      setNotice("The selected PDF exceeds the upload size limit.", "error");
      return;
    }

    submit.disabled = true;
    setNotice("Uploading the PDF…", "pending");
    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: new FormData(form),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "The PDF could not be uploaded.");
      }
      state.uploadSubject = result.material.subject;
      state.uploadFolder = result.material.folder;
      await reloadCatalog();
      setNotice('Uploaded "' + result.material.title + '".', "success");
    } catch (error) {
      setNotice(error.message || "The PDF could not be uploaded.", "error");
      submit.disabled = false;
    }
  }

  async function handleDeleteFolder(form) {
    const dialog = app.querySelector("#admin-delete-dialog");
    const confirmation = app.querySelector("#admin-delete-confirmation");
    const errorText = app.querySelector("#admin-delete-error");
    if (confirmation.value.trim().toLowerCase() !== "delete") {
      errorText.textContent = 'Please type "delete" to confirm.';
      confirmation.focus();
      return;
    }
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    errorText.textContent = "Deleting folder and files…";
    try {
      const result = await requestJson("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: dialog.dataset.subject,
          folder: dialog.dataset.folder,
        }),
      });
      state.folderSubject = dialog.dataset.subject;
      if (state.uploadFolder === dialog.dataset.folder &&
          state.uploadSubject === dialog.dataset.subject) {
        state.uploadFolder = "";
      }
      dialog.close();
      await reloadCatalog();
      setNotice(result.message, "success");
    } catch (error) {
      errorText.textContent = error.message || "The folder could not be deleted.";
    } finally {
      submit.disabled = false;
    }
  }

  async function handleEditMaterial(form) {
    const materialId = form.dataset.editForm;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    setNotice("Saving document details…", "pending");
    try {
      const formData = new FormData(form);
      await requestJson("/api/materials/" + encodeURIComponent(materialId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.get("title"),
          folder: formData.get("folder"),
          description: formData.get("description"),
        }),
      });
      state.editingMaterialId = "";
      await reloadCatalog();
      setNotice("Document details saved.", "success");
    } catch (error) {
      setNotice(error.message || "The document details could not be saved.", "error");
      submit.disabled = false;
    }
  }

  async function replacePdf(materialId, fileInput) {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setNotice("Choose a PDF file to replace this document.", "error");
      fileInput.value = "";
      return;
    }
    if (state.health.maxUploadBytes && file.size > state.health.maxUploadBytes) {
      setNotice("The selected PDF exceeds the upload size limit.", "error");
      fileInput.value = "";
      return;
    }
    if (!window.confirm('Replace the PDF with "' + file.name + '"?')) {
      fileInput.value = "";
      return;
    }
    setNotice("Replacing the PDF…", "pending");
    try {
      const formData = new FormData();
      formData.append("pdf", file);
      await requestJson(
        "/api/materials/" + encodeURIComponent(materialId) + "/replace-pdf",
        { method: "PUT", body: formData },
      );
      await reloadCatalog();
      setNotice("PDF replaced successfully.", "success");
    } catch (error) {
      setNotice(error.message || "The PDF could not be replaced.", "error");
    }
  }

  async function deleteMaterial(materialId) {
    const material = state.catalog.materials.find(
      (item) => item.id === materialId,
    );
    if (!material || !window.confirm(
      'Delete "' + material.title + '" from the local portal?'
    )) return;
    setNotice("Deleting the document…", "pending");
    try {
      await requestJson("/api/materials/" + encodeURIComponent(materialId), {
        method: "DELETE",
      });
      await reloadCatalog();
      setNotice('Deleted "' + material.title + '".', "success");
    } catch (error) {
      setNotice(error.message || "The document could not be deleted.", "error");
    }
  }

  app.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "admin-subject-form") {
      event.preventDefault();
      handleCreateSubject(form);
    } else if (form.id === "admin-folder-form") {
      event.preventDefault();
      handleCreateFolder(form);
    } else if (form.id === "admin-upload-form") {
      event.preventDefault();
      handleUpload(form);
    } else if (form.id === "admin-delete-form") {
      event.preventDefault();
      handleDeleteFolder(form);
    } else if (form.matches("[data-edit-form]")) {
      event.preventDefault();
      handleEditMaterial(form);
    }
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "admin-folder-subject") {
      state.folderSubject = target.value;
      renderFolderList();
      return;
    }
    if (target.id === "admin-upload-subject") {
      state.uploadSubject = target.value;
      state.uploadFolder = foldersForSubject(target.value)[0] || "";
      updateUploadFolderOptions();
      renderDocumentList();
      return;
    }
    if (target.id === "admin-upload-folder") {
      state.uploadFolder = target.value;
      return;
    }
    if (target.matches("[data-replace-material]")) {
      replacePdf(target.dataset.replaceMaterial, target);
    }
  });

  app.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.hasAttribute("data-delete-folder")) {
      openFolderDeleteDialog(target.dataset.subject, target.dataset.folder);
    } else if (target.hasAttribute("data-cancel-folder-delete")) {
      app.querySelector("#admin-delete-dialog").close();
    } else if (target.hasAttribute("data-edit-material")) {
      state.editingMaterialId = target.dataset.editMaterial;
      renderDocumentList();
    } else if (target.hasAttribute("data-cancel-edit")) {
      state.editingMaterialId = "";
      renderDocumentList();
    } else if (target.hasAttribute("data-delete-material")) {
      deleteMaterial(target.dataset.deleteMaterial);
    }
  });

  document.querySelector("[data-admin-logout]")?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault();
      try {
        await fetch("/api/session", { method: "DELETE" });
      } finally {
        window.location.replace("/login/");
      }
    },
  );

  async function load() {
    try {
      await reloadCatalog();
    } catch (error) {
      app.querySelector(".admin-shell").innerHTML = [
        '<div class="admin-spacer" aria-hidden="true"></div>',
        '<section class="state-card"><h1 class="state-title">',
        'The content manager is unavailable</h1><p class="state-message">',
        escapeHtml(error.message || "Start the local Python server and reload this page."),
        '</p></section>',
      ].join("");
    }
  }

  load();
})();
