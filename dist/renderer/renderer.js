"use strict";
(() => {
  // src/renderer/renderer.ts
  var statusText = document.getElementById("status-text");
  var footerText = document.getElementById("footer-text");
  var btnRescan = document.getElementById("btn-rescan");
  var btnSearchAreas = document.getElementById("btn-search-areas");
  var searchInput = document.getElementById("search-input");
  var btnClearSearch = document.getElementById("btn-clear-search");
  var resultsHeader = document.getElementById("results-header");
  var resultsCount = document.getElementById("results-count");
  var resultsList = document.getElementById("results-list");
  var updateBanner = document.getElementById("update-banner");
  var updateBannerText = document.getElementById("update-banner-text");
  var btnViewUpdate = document.getElementById("btn-view-update");
  var btnDismissUpdate = document.getElementById("btn-dismiss-update");
  var actionThemeToggle = document.getElementById("action-theme-toggle");
  var actionSearchAreas = document.getElementById("action-search-areas");
  var actionAbout = document.getElementById("action-about");
  var actionCopyright = document.getElementById("action-copyright");
  var actionFeedback = document.getElementById("action-feedback");
  var popoverOverlay = document.getElementById("popover-overlay");
  var popoverClose = document.getElementById("popover-close");
  var popoverBody = document.getElementById("popover-body");
  var searchDebounceTimer = null;
  var cachedAboutData = null;
  var currentUpdateUrl = "";
  var activeTheme = "dark";
  function applyTheme(theme, notifyMain = true) {
    activeTheme = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", activeTheme);
    if (actionThemeToggle) {
      actionThemeToggle.textContent = activeTheme === "dark" ? "Tema: Koyu" : "Tema: A\xE7\u0131k";
    }
    try {
      localStorage.setItem("metinbul:theme", activeTheme);
    } catch {
    }
    if (notifyMain && window.api?.setTheme) {
      window.api.setTheme(activeTheme);
    }
  }
  function initTheme() {
    let savedTheme = "dark";
    try {
      const item = localStorage.getItem("metinbul:theme");
      if (item === "light" || item === "dark") {
        savedTheme = item;
      }
    } catch {
      savedTheme = "dark";
    }
    applyTheme(savedTheme, true);
  }
  function sanitizeSnippet(snippet) {
    if (!snippet) return "";
    return snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
  }
  function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function getExtClass(ext) {
    const clean = ext.replace(".", "").toLowerCase();
    switch (clean) {
      case "docx":
        return "ext-docx";
      case "pdf":
        return "ext-pdf";
      case "udf":
        return "ext-udf";
      case "doc":
        return "ext-doc";
      default:
        return "";
    }
  }
  function renderResults(results, query) {
    resultsList.innerHTML = "";
    if (!query.trim()) {
      resultsHeader.classList.add("hidden");
      resultsList.innerHTML = `
      <div class="placeholder-state">
        <p>Belgelerinizde aramak istedi\u011Finiz ifadeyi yaz\u0131n.</p>
      </div>
    `;
      return;
    }
    resultsHeader.classList.remove("hidden");
    resultsCount.textContent = `${results.length} sonu\xE7`;
    if (results.length === 0) {
      resultsList.innerHTML = `
      <div class="placeholder-state">
        <p>E\u015Fle\u015Fen belge bulunamad\u0131.</p>
      </div>
    `;
      return;
    }
    results.forEach((result) => {
      const row = document.createElement("div");
      row.className = "result-row";
      const extName = (result.extension || "").replace(".", "").toUpperCase();
      const extClass = getExtClass(result.extension);
      row.innerHTML = `
      <div class="result-row-header">
        <div class="result-title-group">
          <span class="ext-badge ${extClass}">${escapeHtml(extName)}</span>
          <span class="result-filename" title="${escapeHtml(result.filename)}">${escapeHtml(result.filename)}</span>
        </div>
        <div class="result-actions">
          <button class="btn-action btn-open">A\xE7</button>
          <button class="btn-action btn-show">Klas\xF6rde G\xF6ster</button>
        </div>
      </div>
      <div class="result-snippet">\u2026${sanitizeSnippet(result.snippet)}\u2026</div>
      <div class="result-path" title="${escapeHtml(result.path)}">${escapeHtml(result.path)}</div>
    `;
      const btnOpen = row.querySelector(".btn-open");
      btnOpen.onclick = (e) => {
        e.stopPropagation();
        handleOpenFile(result.path);
      };
      const btnShow = row.querySelector(".btn-show");
      btnShow.onclick = (e) => {
        e.stopPropagation();
        handleShowInFolder(result.path);
      };
      row.onclick = () => {
        handleOpenFile(result.path);
      };
      resultsList.appendChild(row);
    });
  }
  var statusTimeoutTimer = null;
  function showTemporaryStatus(message, durationMs = 4e3) {
    if (statusTimeoutTimer) {
      clearTimeout(statusTimeoutTimer);
    }
    statusText.textContent = message;
    statusTimeoutTimer = setTimeout(() => {
      updateStatusFromDb();
    }, durationMs);
  }
  async function handleOpenFile(filePath) {
    const res = await window.api.openFile(filePath);
    if (!res.success && res.error) {
      showTemporaryStatus(res.error);
    }
  }
  async function handleShowInFolder(filePath) {
    const res = await window.api.showInFolder(filePath);
    if (!res.success && res.error) {
      showTemporaryStatus(res.error);
    }
  }
  async function performSearch(query) {
    if (!query || !query.trim()) {
      btnClearSearch.classList.add("hidden");
      renderResults([], "");
      return;
    }
    btnClearSearch.classList.remove("hidden");
    const results = await window.api.search(query);
    renderResults(results, query);
  }
  async function updateStatusFromDb() {
    try {
      const count = await window.api.getDocumentCount();
      if (count > 0) {
        const formatted = count.toLocaleString("tr-TR");
        statusText.textContent = `${formatted} belge indekslendi`;
        footerText.textContent = `${formatted} belge indekslendi`;
      } else {
        statusText.textContent = "Haz\u0131r";
        footerText.textContent = "0 belge indekslendi";
      }
    } catch {
      statusText.textContent = "Haz\u0131r";
      footerText.textContent = "";
    }
  }
  function showUpdateBanner(info) {
    if (!info || !info.updateAvailable) return;
    currentUpdateUrl = info.releaseUrl || "https://github.com/raciyuksekbas-hub/metinbul-releases/releases";
    if (updateBannerText) {
      updateBannerText.textContent = `MetinBul ${info.latestVersion || ""} kullan\u0131labilir`;
    }
    if (updateBanner) {
      updateBanner.classList.remove("hidden");
    }
  }
  function hideUpdateBanner() {
    if (updateBanner) {
      updateBanner.classList.add("hidden");
    }
  }
  async function getAboutData() {
    if (!cachedAboutData && window.api?.getAboutInfo) {
      cachedAboutData = await window.api.getAboutInfo();
    }
    return cachedAboutData;
  }
  async function showDialog(type) {
    if (type === "search-areas") {
      async function renderSearchAreasContent() {
        const mode = await window.api.getSearchScopeMode();
        const areas = await window.api.getSearchAreas();
        const includes = areas.filter((a) => a.type === "include");
        const excludes = areas.filter((a) => a.type === "exclude");
        let includesHtml = "";
        if (includes.length === 0) {
          includesHtml = `
          <div class="search-areas-empty">
            Hen\xFCz klas\xF6r eklenmedi. Arama yapabilmek i\xE7in en az bir klas\xF6r ekleyin.
          </div>
        `;
        } else {
          includesHtml = `
          <div class="search-areas-list">
            ${includes.map((area) => `
              <div class="search-area-item">
                <div class="search-area-info">
                  <span class="area-badge area-badge-include">Eklenen</span>
                  <span class="search-area-path" title="${escapeHtml(area.path)}">${escapeHtml(area.path)}</span>
                </div>
                <button class="btn-action btn-remove-area" data-path="${escapeHtml(area.path)}" type="button">Kald\u0131r</button>
              </div>
            `).join("")}
          </div>
        `;
        }
        let excludesHtml = "";
        if (excludes.length === 0) {
          excludesHtml = `
          <div class="search-areas-empty">
            Hari\xE7 tutulan klas\xF6r yok.
          </div>
        `;
        } else {
          excludesHtml = `
          <div class="search-areas-list">
            ${excludes.map((area) => `
              <div class="search-area-item">
                <div class="search-area-info">
                  <span class="area-badge area-badge-exclude">Hari\xE7 Tutulan</span>
                  <span class="search-area-path" title="${escapeHtml(area.path)}">${escapeHtml(area.path)}</span>
                </div>
                <button class="btn-action btn-remove-area" data-path="${escapeHtml(area.path)}" type="button">Kald\u0131r</button>
              </div>
            `).join("")}
          </div>
        `;
        }
        popoverBody.innerHTML = `
        <div class="popover-section">
          <div class="popover-title-sm">Arama Alanlar\u0131</div>
          <p class="popover-desc">MetinBul bilgisayar\u0131n\u0131z\u0131n genelinde arama yapabilir veya aramay\u0131 yaln\u0131zca se\xE7ti\u011Finiz klas\xF6rlerle s\u0131n\u0131rland\u0131rabilir.</p>
          
          <div class="search-mode-section">
            <div class="search-mode-label">Arama \xD6l\xE7\xFCt\xFC</div>
            <div class="search-mode-options">
              <label class="radio-label">
                <input type="radio" name="search-scope-mode" value="all" ${mode === "all" ? "checked" : ""}>
                <span>Bilgisayar\u0131n T\xFCm\xFC</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="search-scope-mode" value="selected" ${mode === "selected" ? "checked" : ""}>
                <span>Sadece Belirli Klas\xF6rler</span>
              </label>
            </div>
            ${mode === "all" ? `
              <div class="search-scope-hint">
                Bilgisayar\u0131n\u0131zdaki eri\u015Filebilir belge konumlar\u0131nda arama yap\u0131l\u0131r. Sistem ve ge\xE7ici dosya alanlar\u0131 taranmaz.
              </div>
            ` : ""}
          </div>

          ${mode === "selected" ? `
            <div class="scope-group">
              <div class="scope-group-header">
                <div class="scope-group-title">\u015Eunlarla S\u0131n\u0131rl\u0131</div>
                <button id="btn-add-include-folder" class="btn-primary-sm" type="button">
                  + Klas\xF6r Ekle
                </button>
              </div>
              <div class="search-areas-container">
                ${includesHtml}
              </div>
            </div>
          ` : ""}

          <div class="scope-group">
            <div class="scope-group-header">
              <div class="scope-group-title">\u015Eunlar D\u0131\u015F\u0131nda</div>
              <button id="btn-add-exclude-folder" class="btn-secondary-sm" type="button">
                + Klas\xF6r Hari\xE7 Tut
              </button>
            </div>
            <div class="search-areas-container">
              ${excludesHtml}
            </div>
          </div>
        </div>
      `;
        popoverBody.querySelectorAll('input[name="search-scope-mode"]').forEach((radio) => {
          radio.onchange = async (e) => {
            const targetMode = e.target.value;
            await window.api.setSearchScopeMode(targetMode);
            await renderSearchAreasContent();
            if (searchInput.value.trim()) {
              performSearch(searchInput.value);
            }
            await updateStatusFromDb();
          };
        });
        const btnAddInclude = popoverBody.querySelector("#btn-add-include-folder");
        if (btnAddInclude) {
          btnAddInclude.onclick = async () => {
            const selected = await window.api.selectFolder();
            if (selected) {
              await window.api.addSearchArea(selected, "include");
              await renderSearchAreasContent();
              if (searchInput.value.trim()) {
                performSearch(searchInput.value);
              }
              await updateStatusFromDb();
            }
          };
        }
        const btnAddExclude = popoverBody.querySelector("#btn-add-exclude-folder");
        if (btnAddExclude) {
          btnAddExclude.onclick = async () => {
            const selected = await window.api.selectFolder();
            if (selected) {
              await window.api.addSearchArea(selected, "exclude");
              await renderSearchAreasContent();
              if (searchInput.value.trim()) {
                performSearch(searchInput.value);
              }
              await updateStatusFromDb();
            }
          };
        }
        popoverBody.querySelectorAll(".btn-remove-area").forEach((btn) => {
          btn.onclick = async (e) => {
            const targetPath = e.currentTarget.dataset.path;
            if (targetPath) {
              await window.api.removeSearchArea(targetPath);
              await renderSearchAreasContent();
              if (searchInput.value.trim()) {
                performSearch(searchInput.value);
              }
              await updateStatusFromDb();
            }
          };
        });
      }
      await renderSearchAreasContent();
      popoverOverlay.classList.remove("hidden");
      return;
    }
    const data = await getAboutData();
    if (!data) return;
    if (type === "about") {
      popoverBody.innerHTML = `
      <div class="popover-section">
        <div class="popover-header">
          <div class="popover-title"><span class="logo-regular">Metin</span><span class="logo-bold">Bul</span></div>
          <div class="popover-version">S\xFCr\xFCm ${escapeHtml(data.version)}</div>
        </div>
        <p class="popover-desc">${escapeHtml(data.shortDescription)}</p>
        <div class="popover-meta">Geli\u015Ftirici: ${escapeHtml(data.developerName)}</div>
      </div>
    `;
    } else if (type === "copyright") {
      popoverBody.innerHTML = `
      <div class="popover-section">
        <div class="popover-title-sm">Telif Bilgisi</div>
        <p class="popover-copyright">${escapeHtml(data.copyright)}</p>
        <p class="popover-desc-sm">${escapeHtml(data.copyrightNote)}</p>
      </div>
    `;
    } else if (type === "feedback") {
      popoverBody.innerHTML = `
      <div class="popover-section">
        <div class="popover-title-sm">Geri Bildirim</div>
        <p class="popover-desc">${escapeHtml(data.feedback.text)}</p>
        <div class="popover-contact">
          <span class="popover-label">E-posta:</span>
          <span class="popover-value" id="feedback-email-value">${escapeHtml(data.feedback.email)}</span>
        </div>
        <div class="popover-actions-split">
          <button id="btn-send-feedback-action" class="btn-primary-sm" type="button">E-posta G\xF6nder</button>
          <button id="btn-copy-feedback-email" class="btn-secondary-sm" type="button">Adresi Kopyala</button>
        </div>
        <div id="feedback-copy-status" class="feedback-copy-status hidden">E-posta adresi kopyaland\u0131.</div>
      </div>
    `;
      const btnSend = popoverBody.querySelector("#btn-send-feedback-action");
      if (btnSend) {
        btnSend.onclick = () => {
          if (data.feedback?.mailtoUrl) {
            window.api.openExternal(data.feedback.mailtoUrl);
          } else {
            window.api.sendFeedback();
          }
        };
      }
      const btnCopy = popoverBody.querySelector("#btn-copy-feedback-email");
      const copyStatus = popoverBody.querySelector("#feedback-copy-status");
      if (btnCopy) {
        btnCopy.onclick = async () => {
          const email = data.feedback.email || "raci@yuksekbas.av.tr";
          let copied = false;
          if (window.api?.copyToClipboard) {
            const res = await window.api.copyToClipboard(email);
            copied = res?.success || false;
          }
          if (!copied && navigator.clipboard) {
            try {
              await navigator.clipboard.writeText(email);
              copied = true;
            } catch {
              copied = false;
            }
          }
          if (copyStatus) {
            copyStatus.classList.remove("hidden");
            setTimeout(() => {
              copyStatus.classList.add("hidden");
            }, 3e3);
          }
        };
      }
    }
    popoverOverlay.classList.remove("hidden");
  }
  function hideDialog() {
    popoverOverlay.classList.add("hidden");
  }
  searchInput.addEventListener("input", () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      performSearch(searchInput.value);
    }, 150);
  });
  btnClearSearch.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.focus();
    performSearch("");
  });
  btnRescan.addEventListener("click", async () => {
    statusText.textContent = "Belgeleriniz taran\u0131yor\u2026";
    await window.api.rescan();
  });
  btnSearchAreas?.addEventListener("click", () => showDialog("search-areas"));
  actionThemeToggle?.addEventListener("click", () => {
    const next = activeTheme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
  btnViewUpdate?.addEventListener("click", () => {
    if (currentUpdateUrl) {
      window.api.openExternal(currentUpdateUrl);
    }
  });
  btnDismissUpdate?.addEventListener("click", hideUpdateBanner);
  actionSearchAreas?.addEventListener("click", () => showDialog("search-areas"));
  actionAbout?.addEventListener("click", () => showDialog("about"));
  actionCopyright?.addEventListener("click", () => showDialog("copyright"));
  actionFeedback?.addEventListener("click", () => showDialog("feedback"));
  popoverClose?.addEventListener("click", hideDialog);
  popoverOverlay?.addEventListener("click", (e) => {
    if (e.target === popoverOverlay) {
      hideDialog();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popoverOverlay.classList.contains("hidden")) {
      hideDialog();
    }
  });
  window.api?.onShowAboutDialog?.(() => {
    showDialog("about");
  });
  window.api?.onShowSearchAreasDialog?.(() => {
    showDialog("search-areas");
  });
  window.api?.onThemeChanged?.((theme) => {
    applyTheme(theme, false);
  });
  window.api?.onUpdateAvailable?.((info) => {
    showUpdateBanner(info);
  });
  window.api.onProgress(async (progress) => {
    if (progress.status === "scanning") {
      statusText.textContent = "Belgeleriniz taran\u0131yor\u2026";
    } else if (progress.status === "indexing") {
      statusText.textContent = `Belgeleriniz indeksleniyor\u2026 (${progress.current}/${progress.total})`;
    } else if (progress.status === "completed") {
      await updateStatusFromDb();
      if (searchInput.value.trim()) {
        performSearch(searchInput.value);
      }
    }
  });
  (async function init() {
    initTheme();
    await updateStatusFromDb();
  })();
})();
